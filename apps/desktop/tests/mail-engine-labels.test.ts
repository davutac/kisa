// oxlint-disable typescript/no-unsafe-type-assertion
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { ThreadId, userLabelId } from "@repo/mail/ids";
import { createLabel, deleteLabel, renameLabel } from "@repo/mail/labels";
import { applyThreadAction } from "@repo/mail/mutations";
import { syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { beforeEach, describe, expect, it } from "vitest";

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

    await run(renameLabel(scope, "u:Work", "Office"));

    expect(threadRow("800")).toMatchObject({
      label_ids: JSON.stringify(["INBOX", "u:Office", "u:Office/Sub"]),
    });
    expect(userLabels()).toStrictEqual([
      { background_color: "#16a766", label_id: "u:Office" },
      { background_color: null, label_id: "u:Office/Sub" },
    ]);
    // Gmail relabels without a new mod-sequence; the cache already agrees.
    await expect(run(syncAccount(scope))).resolves.toMatchObject({
      changed: [],
    });
  });

  it("deletes a label and takes it off its conversations", async () => {
    const { scope } = await syncGmailWorkMessage();

    await run(deleteLabel(scope, "u:Work"));

    expect(threadRow("800")).toMatchObject({
      label_ids: JSON.stringify(["INBOX", "u:Work/Sub"]),
    });
    expect(userLabels()).toStrictEqual([
      { background_color: null, label_id: "u:Work/Sub" },
    ]);
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
    expect(server.calls).not.toContain("fetch Bills");
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
