// oxlint-disable typescript/no-unsafe-type-assertion
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { SystemLabel, ThreadId, userLabelId } from "@repo/mail/ids";
import { applyThreadAction } from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import { bodyStep, skeletonStep, syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  TRASH,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  messageRow,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";

const SPAM = "[Gmail]/Spam";

const act = (scope: SyncScope, threadId: string, action: ThreadAction) =>
  run(applyThreadAction(scope, [ThreadId.make(threadId)], action));

const label = (labelId: string, applied: boolean): ThreadAction => ({
  applied,
  kind: "setLabel",
  labelId: labelId as never,
});

/** A synced Gmail account whose server files moves into INBOX in All Mail. */
const syncGmail = async (...ids: readonly string[]) => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES, undefined, ALL_MAIL);
  for (const id of ids) {
    server.deliver(ALL_MAIL, gmailMessage(id, id));
  }
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  return { scope, server };
};

const syncIcloud = async (
  messages: readonly { readonly id: string; readonly path: string }[]
) => {
  insertAccount("generic");
  const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
  for (const { id, path } of messages) {
    server.deliver(path, genericMessage(id));
  }
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);
  return { scope, server };
};

/** The cached ids of the generic message with this subject. */
const genericIds = (subject: string) =>
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

describe("thread actions with the Gmail dialect", () => {
  beforeEach(resetDatabase);

  it("adds and removes a user label on the All Mail copy", async () => {
    const { scope, server } = await syncGmail("600");

    await act(scope, "600", label(userLabelId("Work"), true));
    expect(server.calls).toContain(`label ${ALL_MAIL} add Work`);
    expect(threadRow("600")).toMatchObject({
      label_ids: JSON.stringify(["INBOX", "u:Work"]),
    });

    await act(scope, "600", label(userLabelId("Work"), false));
    expect(threadRow("600")).toMatchObject({
      label_ids: JSON.stringify(["INBOX"]),
    });
    // The server agrees, so the next sync has nothing to report.
    await expect(run(syncAccount(scope))).resolves.toMatchObject({
      changed: [],
    });
  });

  it("archives by removing \\Inbox and stars with \\Flagged", async () => {
    const { scope, server } = await syncGmail("610");

    await act(scope, "610", label(SystemLabel.inbox, false));
    await act(scope, "610", label(SystemLabel.starred, true));

    expect(server.calls).toStrictEqual(
      expect.arrayContaining([
        `label ${ALL_MAIL} remove \\Inbox`,
        `store ${ALL_MAIL} add \\Flagged`,
      ])
    );
    expect(threadRow("610")).toMatchObject({
      is_in_inbox: 0,
      label_ids: JSON.stringify(["STARRED"]),
    });
    await expect(run(syncAccount(scope))).resolves.toMatchObject({
      changed: [],
    });
  });

  it("trashes a conversation without losing its body, then restores it", async () => {
    const { scope, server } = await syncGmail("620");
    await run(bodyStep(scope));

    await act(scope, "620", { kind: "trash" });
    expect(server.calls).toContain(`move ${ALL_MAIL} -> ${TRASH}`);
    expect(threadRow("620")).toMatchObject({ is_in_trash: 1 });
    expect(messageRow("620")).toMatchObject({ body_state: "ready" });

    await act(scope, "620", { kind: "moveToInbox" });
    expect(server.calls).toContain(`move ${TRASH} -> INBOX`);
    expect(threadRow("620")).toMatchObject({ is_in_inbox: 1, is_in_trash: 0 });
  });

  it("reports spam and brings it back as not spam", async () => {
    const { scope } = await syncGmail("630");

    await act(scope, "630", { kind: "moveToSpam" });
    expect(threadRow("630")).toMatchObject({ is_in_spam: 1 });
    expect(locationPaths("630")).toStrictEqual([SPAM]);

    await act(scope, "630", { kind: "moveToInbox" });
    expect(threadRow("630")).toMatchObject({ is_in_inbox: 1, is_in_spam: 0 });
    expect(locationPaths("630")).toStrictEqual([ALL_MAIL]);
  });

  it("deletes forever only what is in Spam or Trash", async () => {
    const { scope, server } = await syncGmail("640");

    await expect(
      act(scope, "640", { kind: "deleteForever" })
    ).rejects.toMatchObject({ _tag: "MailProtocolError" });
    expect(threadRow("640")).toBeDefined();

    await act(scope, "640", { kind: "trash" });
    await act(scope, "640", { kind: "deleteForever" });
    expect(server.calls).toContain(`expunge ${TRASH}`);
    expect(threadRow("640")).toBeUndefined();
  });

  it("deletes forever while older mail is still being walked", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    for (let id = 700; id < 1300; id += 1) {
      server.deliver(ALL_MAIL, gmailMessage(String(id), String(id)));
    }
    const scope = scopeFor(server, gmailDialect);
    await run(syncAccount(scope));
    await run(skeletonStep(scope));

    await act(scope, "1299", { kind: "trash" });
    await act(scope, "1299", { kind: "deleteForever" });

    expect(threadRow("1299")).toBeUndefined();
    expect(messageRow("1299")).toBeUndefined();
  });

  it("refuses a label the account does not have", async () => {
    const { scope } = await syncGmail("660");

    await expect(
      act(scope, "660", label(userLabelId("Missing"), true))
    ).rejects.toMatchObject({ _tag: "MailProtocolError" });
    await expect(
      act(scope, "660", label(SystemLabel.sent, true))
    ).rejects.toMatchObject({ _tag: "MailProtocolError" });
  });

  it("marks several conversations read in one action", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("650", "650", { flags: [] }));
    server.deliver(ALL_MAIL, gmailMessage("651", "651", { flags: [] }));
    const scope = scopeFor(server, gmailDialect);
    await syncFully(scope);

    const changes = await run(
      applyThreadAction(scope, [ThreadId.make("650"), ThreadId.make("651")], {
        kind: "setRead",
        read: true,
      })
    );

    expect(changes.changed).toStrictEqual(
      expect.arrayContaining(["650", "651"])
    );
    expect(
      server.calls.filter((call) => call.startsWith("store"))
    ).toHaveLength(1);
    expect([threadRow("650"), threadRow("651")]).toMatchObject([
      { is_unread: 0 },
      { is_unread: 0 },
    ]);
  });
});

describe("thread actions with the generic dialect", () => {
  beforeEach(resetDatabase);

  it("archives by moving the Inbox copy to Archive, and back", async () => {
    const { scope, server } = await syncIcloud([{ id: "a", path: "INBOX" }]);
    const { message_id: messageId, thread_id: threadId } = genericIds("a");

    await act(scope, threadId, label(SystemLabel.inbox, false));
    expect(server.calls).toContain("move INBOX -> Archive");
    expect(threadRow(threadId)).toMatchObject({ is_in_inbox: 0 });
    expect(locationPaths(messageId)).toStrictEqual(["Archive"]);

    await act(scope, threadId, label(SystemLabel.inbox, true));
    expect(threadRow(threadId)).toMatchObject({ is_in_inbox: 1 });
  });

  it("labels by copying into the folder and unlabels without losing mail", async () => {
    const { scope, server } = await syncIcloud([
      { id: "b", path: "INBOX" },
      { id: "c", path: "Receipts" },
    ]);
    const kept = genericIds("b");
    const filed = genericIds("c");

    await act(scope, kept.thread_id, label(userLabelId("Receipts"), true));
    expect(server.calls).toContain("copy INBOX -> Receipts");
    expect(locationPaths(kept.message_id)).toStrictEqual(["INBOX", "Receipts"]);

    // Another copy remains, so the folder copy is simply removed.
    await act(scope, kept.thread_id, label(userLabelId("Receipts"), false));
    expect(locationPaths(kept.message_id)).toStrictEqual(["INBOX"]);

    // The only copy moves to Archive instead of disappearing.
    await act(scope, filed.thread_id, label(userLabelId("Receipts"), false));
    expect(locationPaths(filed.message_id)).toStrictEqual(["Archive"]);
  });

  it("archives a folder's copy when the only other copy is in Trash", async () => {
    const { scope, server } = await syncIcloud([
      { id: "e", path: "Receipts" },
      { id: "e", path: "Deleted Messages" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("e");

    await act(scope, threadId, label(userLabelId("Receipts"), false));

    expect(server.calls).not.toContain("expunge Receipts");
    expect(locationPaths(messageId)).toStrictEqual([
      "Archive",
      "Deleted Messages",
    ]);
  });

  it("archives duplicate copies in one folder rather than deleting both", async () => {
    const { scope, server } = await syncIcloud([
      { id: "f", path: "Receipts" },
      { id: "f", path: "Receipts" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("f");

    await act(scope, threadId, label(userLabelId("Receipts"), false));

    expect(server.calls).not.toContain("expunge Receipts");
    expect(locationPaths(messageId)).toStrictEqual(["Archive", "Archive"]);
  });

  it("trashes every copy into Deleted Messages", async () => {
    const { scope } = await syncIcloud([
      { id: "d", path: "INBOX" },
      { id: "d", path: "Receipts" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("d");

    await act(scope, threadId, { kind: "trash" });

    expect(locationPaths(messageId)).toStrictEqual([
      "Deleted Messages",
      "Deleted Messages",
    ]);
    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 0,
      is_in_trash: 1,
    });
  });
});
