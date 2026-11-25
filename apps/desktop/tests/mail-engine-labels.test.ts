// oxlint-disable typescript/no-unsafe-type-assertion
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { ThreadId, userLabelId } from "@repo/mail/ids";
import { createLabel, deleteLabel, renameLabel } from "@repo/mail/labels";
import { applyThreadAction } from "@repo/mail/mutations";
import { relabelStep, syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { seededLabelColor } from "../src/shared/label-color";
import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";

const userLabels = () =>
  connection
    .prepare(
      "SELECT label_id, background_color FROM mail_labels WHERE kind = 'user' ORDER BY label_id"
    )
    .all();

const labelCursors = () =>
  connection
    .prepare(
      "SELECT path, label_cursor FROM mail_mailboxes WHERE label_cursor IS NOT NULL ORDER BY path"
    )
    .all();

/** A full pass that also reports whether its discovery changed the labels. */
const syncReportingLabels = async (scope: SyncScope) => {
  let labelsChanged: boolean | undefined;
  const changes = await run(
    syncAccount({
      ...scope,
      discovered: (discovery) =>
        Effect.sync(() => {
          ({ labelsChanged } = discovery);
        }),
    })
  );
  return { changes, labelsChanged };
};

/** Runs the label reread to its end and returns how many steps it took. */
const relabelFully = async (scope: SyncScope): Promise<number> => {
  for (let step = 0; step < 100; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    if ((await run(relabelStep(scope))) === undefined) {
      return step;
    }
  }
  throw new Error("label reread did not finish");
};

const fileUnder = (scope: SyncScope, threadId: string, labelId: string) =>
  run(
    applyThreadAction(scope, [ThreadId.make(threadId)], {
      applied: true,
      kind: "setLabel",
      labelId: labelId as never,
    })
  );

const genericMessageIds = (subject: string) =>
  connection
    .prepare(
      "SELECT message_id, thread_id FROM mail_messages WHERE subject = ?"
    )
    .get(subject) as { message_id: string; thread_id: string };

const locationPaths = (messageId: string) =>
  (
    connection
      .prepare(
        "SELECT mailbox_path FROM mail_message_locations WHERE message_id = ? ORDER BY mailbox_path"
      )
      .all(messageId) as { mailbox_path: string }[]
  ).map((row) => row.mailbox_path);

const syncGmailWorkMessage = async () => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  server.addMailbox("Work/Sub");
  server.deliver(
    ALL_MAIL,
    gmailMessage("800", "800", {
      gmailLabels: ["\\Inbox", "Work", "Work/Sub"],
    })
  );
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  return { scope, server };
};

const syncIcloudReceipt = async () => {
  insertAccount("generic");
  const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
  server.deliver("INBOX", genericMessage("inbox"));
  server.deliver("Receipts", genericMessage("receipt"));
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);
  return { scope, server };
};

describe("labels with the Gmail dialect", () => {
  beforeEach(resetDatabase);

  it("creates a nested label that takes conversations at once", async () => {
    const { scope, server } = await syncGmailWorkMessage();

    const created = await run(createLabel(scope, " Projects / Kisa "));
    await fileUnder(scope, "800", created.label.id);

    expect(created.label).toStrictEqual({
      id: "u:Projects/Kisa",
      name: "Projects/Kisa",
    });
    expect(server.calls).toContain("create Projects/Kisa");
    expect(threadRow("800")?.label_ids).toContain("u:Projects/Kisa");
  });

  it("renames a label and those under it, keeping colours and conversations", async () => {
    const { scope } = await syncGmailWorkMessage();
    connection
      .prepare(
        "UPDATE mail_labels SET background_color = '#16a766', text_color = '#ffffff' WHERE label_id = 'u:Work'"
      )
      .run();

    await run(renameLabel(scope, userLabelId("Work"), "Office"));

    expect(threadRow("800")).toMatchObject({
      label_ids: JSON.stringify(["INBOX", "u:Office", "u:Office/Sub"]),
    });
    expect(userLabels()).toStrictEqual([
      { background_color: "#16a766", label_id: "u:Office" },
      {
        background_color: seededLabelColor("Work/Sub"),
        label_id: "u:Office/Sub",
      },
    ]);
    // Gmail relabels without a new mod-sequence; the cache already agrees.
    await expect(run(syncAccount(scope))).resolves.toMatchObject({
      changed: [],
    });
  });

  it("deletes a label and takes it off its conversations", async () => {
    const { scope } = await syncGmailWorkMessage();

    await run(deleteLabel(scope, userLabelId("Work")));

    expect(threadRow("800")).toMatchObject({
      label_ids: JSON.stringify(["INBOX", "u:Work/Sub"]),
    });
    expect(userLabels()).toStrictEqual([
      {
        background_color: seededLabelColor("Work/Sub"),
        label_id: "u:Work/Sub",
      },
    ]);
  });

  it("reads labels again after a label is renamed on the web", async () => {
    const { scope, server } = await syncGmailWorkMessage();
    server.deliver(
      ALL_MAIL,
      gmailMessage("801", "801", { gmailLabels: ["\\Inbox"] })
    );
    await run(syncAccount(scope));

    server.renameMailbox("Work", "Office");
    const synced = await syncReportingLabels(scope);
    const beforeReread = threadRow("800")?.label_ids;
    const armed = labelCursors();
    const firstStep = await run(relabelStep(scope));
    const steps = await relabelFully(scope);

    expect({
      armed,
      beforeReread,
      firstStep,
      labelIds: threadRow("800")?.label_ids,
      labelsChanged: synced.labelsChanged,
      left: labelCursors(),
      steps,
    }).toStrictEqual({
      armed: [{ label_cursor: 3, path: ALL_MAIL }],
      // The old names come off at once; the new ones need the reread.
      beforeReread: JSON.stringify(["INBOX"]),
      // Only the conversation whose labels differ is written.
      firstStep: { changed: ["800"], removed: [] },
      labelIds: JSON.stringify(["INBOX", "u:Office", "u:Office/Sub"]),
      labelsChanged: true,
      left: [],
      steps: 1,
    });
  });

  it("takes a label deleted on the web off its conversations without reading them again", async () => {
    const { scope, server } = await syncGmailWorkMessage();

    server.removeMailbox("Work");
    const synced = await syncReportingLabels(scope);

    expect({
      labelIds: threadRow("800")?.label_ids,
      labelsChanged: synced.labelsChanged,
      reread: await run(relabelStep(scope)),
    }).toStrictEqual({
      labelIds: JSON.stringify(["INBOX", "u:Work/Sub"]),
      labelsChanged: true,
      reread: undefined,
    });
  });

  it("reads labels again after a rename in Kisa, and caches them as the server has them", async () => {
    const { scope, server } = await syncGmailWorkMessage();

    await run(renameLabel(scope, userLabelId("Work"), "Office"));
    const moved = threadRow("800")?.label_ids;
    const armed = labelCursors();
    // What the server made of the rename differs from the rule the cache
    // was moved by.
    server.setGmailLabels(ALL_MAIL, 1, ["\\Inbox", "Office"]);
    const steps = await relabelFully(scope);

    expect({
      armed,
      labelIds: threadRow("800")?.label_ids,
      left: labelCursors(),
      moved,
      steps,
    }).toStrictEqual({
      armed: [{ label_cursor: 2, path: ALL_MAIL }],
      labelIds: JSON.stringify(["INBOX", "u:Office"]),
      left: [],
      moved: JSON.stringify(["INBOX", "u:Office", "u:Office/Sub"]),
      // One step reads the copies, and one finds none left.
      steps: 2,
    });
  });

  it("reads no labels again for an unchanged list or a new label", async () => {
    const { scope, server } = await syncGmailWorkMessage();

    const unchanged = await syncReportingLabels(scope);
    await run(createLabel(scope, "Travel"));
    server.addMailbox("Receipts");
    const added = await syncReportingLabels(scope);

    expect({
      added: added.labelsChanged,
      cursors: labelCursors(),
      unchanged: unchanged.labelsChanged,
    }).toStrictEqual({ added: true, cursors: [], unchanged: false });
  });

  it("resumes a label reread that failed, and starts it over after another rename", async () => {
    const { scope, server } = await syncGmailWorkMessage();
    server.renameMailbox("Work", "Office");
    await run(syncAccount(scope));

    server.dropFetch = () => true;
    await expect(run(relabelStep(scope))).rejects.toMatchObject({
      _tag: "MailConnectionError",
    });
    server.dropFetch = undefined;
    const kept = labelCursors();
    await run(relabelStep(scope));
    const moved = labelCursors();
    server.renameMailbox("Office", "Desk");
    await run(syncAccount(scope));
    const restarted = labelCursors();
    await relabelFully(scope);

    expect({
      kept,
      labelIds: threadRow("800")?.label_ids,
      moved,
      restarted,
    }).toStrictEqual({
      kept: [{ label_cursor: 2, path: ALL_MAIL }],
      labelIds: JSON.stringify(["INBOX", "u:Desk", "u:Desk/Sub"]),
      moved: [{ label_cursor: 1, path: ALL_MAIL }],
      restarted: [{ label_cursor: 2, path: ALL_MAIL }],
    });
  });

  it("refuses names Gmail or the mailbox list would misread", async () => {
    const { scope } = await syncGmailWorkMessage();

    for (const name of ["Inbox", "work", "a//b", "[Gmail]/x"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await expect(run(createLabel(scope, name))).rejects.toMatchObject({
        _tag: "MailProtocolError",
      });
    }
  });
});

describe("labels with the generic dialect", () => {
  beforeEach(resetDatabase);

  it("colours a folder when first seen, and keeps a chosen colour through later syncs", async () => {
    const { scope } = await syncIcloudReceipt();
    const discovered = userLabels();
    connection
      .prepare(
        "UPDATE mail_labels SET background_color = '#123456' WHERE label_id = 'u:Receipts'"
      )
      .run();
    await run(syncAccount(scope));
    const chosen = userLabels();
    connection
      .prepare(
        "UPDATE mail_labels SET background_color = NULL WHERE label_id = 'u:Receipts'"
      )
      .run();
    await run(syncAccount(scope));

    expect({ chosen, discovered, refilled: userLabels() }).toStrictEqual({
      chosen: [{ background_color: "#123456", label_id: "u:Receipts" }],
      discovered: [
        {
          background_color: seededLabelColor("Receipts"),
          label_id: "u:Receipts",
        },
      ],
      refilled: [
        {
          background_color: seededLabelColor("Receipts"),
          label_id: "u:Receipts",
        },
      ],
    });
  });

  it("reports folders another client added or deleted", async () => {
    const { scope, server } = await syncIcloudReceipt();

    const unchanged = await syncReportingLabels(scope);
    server.removeMailbox("Receipts");
    const deleted = await syncReportingLabels(scope);
    const deletedLabels = userLabels();
    server.addMailbox("Travel");
    const added = await syncReportingLabels(scope);
    server.renameMailbox("Travel", "Trips");
    await run(syncAccount(scope));

    expect({
      added: added.labelsChanged,
      deleted: deleted.labelsChanged,
      deletedLabels,
      labels: userLabels(),
      unchanged: unchanged.labelsChanged,
    }).toStrictEqual({
      added: true,
      deleted: true,
      deletedLabels: [],
      labels: [
        {
          background_color: seededLabelColor("Trips"),
          label_id: "u:Trips",
        },
      ],
      unchanged: false,
    });
    // Folders are read as mailboxes, so a rename needs no label reread.
    expect(labelCursors()).toStrictEqual([]);
  });

  it("reports a deleted folder even when the rest of the pass fails", async () => {
    const { scope, server } = await syncIcloudReceipt();
    const { thread_id: threadId } = genericMessageIds("receipt");
    server.removeMailbox("Receipts");
    server.deliver("INBOX", genericMessage("later"));
    server.dropFetch = () => true;
    const reported: unknown[] = [];

    await expect(
      run(
        syncAccount({
          ...scope,
          discovered: ({ changes, labelsChanged }) =>
            Effect.sync(() => {
              reported.push({ changed: changes.changed, labelsChanged });
            }),
        })
      )
    ).rejects.toMatchObject({ _tag: "MailConnectionError" });
    expect(reported).toStrictEqual([
      { changed: [threadId], labelsChanged: true },
    ]);
  });

  it("creates a folder that takes mail at once", async () => {
    const { scope } = await syncIcloudReceipt();
    const { message_id: messageId, thread_id: threadId } =
      genericMessageIds("inbox");

    const created = await run(createLabel(scope, "Travel"));
    await fileUnder(scope, threadId, created.label.id);

    expect(locationPaths(messageId)).toStrictEqual(["INBOX", "Travel"]);
    expect(threadRow(threadId)?.label_ids).toContain("u:Travel");
  });

  it("renames a folder without walking it again", async () => {
    const { scope, server } = await syncIcloudReceipt();
    const { message_id: messageId, thread_id: threadId } =
      genericMessageIds("receipt");

    await run(renameLabel(scope, userLabelId("Receipts"), "Bills"));
    const changes = await run(syncAccount(scope));

    expect(locationPaths(messageId)).toStrictEqual(["Bills"]);
    expect(threadRow(threadId)).toMatchObject({
      label_ids: JSON.stringify(["u:Bills"]),
    });
    expect(changes.changed).toStrictEqual([]);
    // Only flags may be read again; no message is fetched anew.
    expect(
      server.fetches.filter(
        (fetch) => fetch.path === "Bills" && fetch.fields.envelope === true
      )
    ).toStrictEqual([]);
  });

  it("reads a renamed folder where it is now, with mail that reached it meanwhile", async () => {
    const { scope, server } = await syncIcloudReceipt();
    server.deliver("Receipts", genericMessage("late"));

    await run(renameLabel(scope, userLabelId("Receipts"), "Bills"));

    expect(locationPaths(genericMessageIds("late")?.message_id)).toStrictEqual([
      "Bills",
    ]);
  });

  it("moves a folder's mail to Archive before deleting it", async () => {
    const { scope, server } = await syncIcloudReceipt();
    const { message_id: messageId, thread_id: threadId } =
      genericMessageIds("receipt");

    await run(deleteLabel(scope, userLabelId("Receipts")));

    expect(server.calls).toStrictEqual(
      expect.arrayContaining(["move Receipts -> Archive", "delete Receipts"])
    );
    expect(locationPaths(messageId)).toStrictEqual(["Archive"]);
    expect(threadRow(threadId)).toMatchObject({ label_ids: "[]" });
    expect(userLabels()).toStrictEqual([]);
  });
});
