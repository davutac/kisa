// oxlint-disable typescript/no-unsafe-type-assertion
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { SystemLabel, ThreadId, userLabelId } from "@repo/mail/ids";
import {
  applyThreadAction,
  partitionReportableThreads,
} from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import { bodyStep, skeletonStep, syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  accountId,
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

/** A generic reply to `parent`, as another message of its conversation. */
const genericReply = (id: string, parent: string) =>
  genericMessage(id, {
    envelope: envelope({
      inReplyTo: `<${parent}@example.com>`,
      messageId: `<${id}@example.com>`,
      subject: id,
    }),
    headers: { references: `<${parent}@example.com>` },
  });

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

/** A message's cached copies: where each is, with its flags and labels. */
const cachedCopiesOf = (messageId: string) =>
  (
    connection
      .prepare(
        "SELECT mailbox_path, flags, label_ids FROM mail_message_locations WHERE message_id = ? ORDER BY mailbox_path"
      )
      .all(messageId) as {
      flags: string;
      label_ids: string;
      mailbox_path: string;
    }[]
  ).map((row) => ({
    flags: JSON.parse(row.flags) as string[],
    labelIds: JSON.parse(row.label_ids) as string[],
    path: row.mailbox_path,
  }));

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

  it("reports spam without moving the user's own reply", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES, undefined, ALL_MAIL);
    server.deliver(ALL_MAIL, gmailMessage("800", "800"));
    server.deliver(
      ALL_MAIL,
      gmailMessage("801", "800", { gmailLabels: ["\\Sent"] })
    );
    const scope = scopeFor(server, gmailDialect);
    await syncFully(scope);

    await act(scope, "800", { kind: "moveToSpam" });
    expect(locationPaths("800")).toStrictEqual([SPAM]);
    expect(locationPaths("801")).toStrictEqual([ALL_MAIL]);
    expect(threadRow("800")).toMatchObject({ is_in_spam: 1 });

    await act(scope, "800", { kind: "moveToInbox" });
    expect(locationPaths("800")).toStrictEqual([ALL_MAIL]);
    expect(threadRow("800")).toMatchObject({ is_in_inbox: 1, is_in_spam: 0 });
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

  it("reads a change back with one fetch of the copies it was made on", async () => {
    const { scope, server } = await syncGmail("670", "671");
    server.fetches.splice(0);

    await act(scope, "671", { kind: "setRead", read: false });

    expect(server.fetches).toStrictEqual([
      {
        changedSince: undefined,
        fields: { flags: true, gmail: true },
        path: ALL_MAIL,
        selection: { kind: "uids", uids: [2] },
      },
    ]);
    expect(threadRow("671")).toMatchObject({ is_unread: 1 });
  });

  it("caches what the server made of a change, not what was asked for", async () => {
    const { scope, server } = await syncGmail("672");
    // Another client files the message under Work as Kisa stars it.
    server.beforeCommand = () => {
      server.beforeCommand = undefined;
      server.setGmailLabels(ALL_MAIL, 1, ["\\Inbox", "Work"]);
    };

    await act(scope, "672", label(SystemLabel.starred, true));

    expect(cachedCopiesOf("672")).toStrictEqual([
      {
        flags: expect.arrayContaining(["\\Flagged"]),
        labelIds: expect.arrayContaining([
          SystemLabel.inbox,
          SystemLabel.starred,
          userLabelId("Work"),
        ]),
        path: ALL_MAIL,
      },
    ]);
  });

  it("keeps a copy in Trash filed under Trash when its flags are read back", async () => {
    const { scope } = await syncGmail("673");
    await act(scope, "673", { kind: "trash" });

    await act(scope, "673", label(SystemLabel.starred, true));

    expect(cachedCopiesOf("673")).toStrictEqual([
      {
        flags: expect.arrayContaining(["\\Flagged"]),
        labelIds: expect.arrayContaining([
          SystemLabel.starred,
          SystemLabel.trash,
        ]),
        path: TRASH,
      },
    ]);
  });

  it("drops a copy that left the server before the change reached it", async () => {
    const { scope, server } = await syncGmail("674", "675");
    server.beforeCommand = () => {
      server.beforeCommand = undefined;
      server.expunge(ALL_MAIL, 1);
    };

    await act(scope, "674", { kind: "setRead", read: false });

    expect(cachedCopiesOf("674")).toStrictEqual([]);
    expect(cachedCopiesOf("675")).toHaveLength(1);
  });
});

describe("thread actions with the generic dialect", () => {
  beforeEach(resetDatabase);

  it("keeps a folder's copy filed under the folder when its flags are read back", async () => {
    const { scope } = await syncIcloud([{ id: "kept", path: "Receipts" }]);
    const { message_id: messageId, thread_id: threadId } = genericIds("kept");

    await act(scope, threadId, label(SystemLabel.starred, true));

    expect(cachedCopiesOf(messageId)).toStrictEqual([
      {
        flags: expect.arrayContaining(["\\Flagged"]),
        labelIds: expect.arrayContaining([
          SystemLabel.starred,
          userLabelId("Receipts"),
        ]),
        path: "Receipts",
      },
    ]);
  });

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

  // A server's "All" is a view: what it shows of the message is the folder's
  // own copy. Counted as another copy, it would let the label's removal
  // delete the only one there is.
  it("archives a folder's only copy though the server's All view shows it too", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(
      [...ICLOUD_MAILBOXES, { path: "virtual/All", specialUse: "\\All" }],
      ["IDLE"]
    );
    server.deliver("Receipts", genericMessage("viewed"));
    server.deliver("virtual/All", genericMessage("viewed"));
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    const { message_id: messageId, thread_id: threadId } = genericIds("viewed");

    await act(scope, threadId, label(userLabelId("Receipts"), false));

    expect(server.calls).toContain("move Receipts -> Archive");
    expect(server.calls).not.toContain("expunge Receipts");
    expect(locationPaths(messageId)).toStrictEqual(["Archive"]);
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

  it("moves only Archive's copies back to the Inbox", async () => {
    const { scope, server } = await syncIcloud([{ id: "g", path: "Receipts" }]);
    const { message_id: messageId, thread_id: threadId } = genericIds("g");

    await expect(
      act(scope, threadId, label(SystemLabel.inbox, true))
    ).rejects.toMatchObject({ _tag: "MailProtocolError" });
    expect(
      server.calls.filter((call) => call.startsWith("move"))
    ).toStrictEqual([]);
    expect(locationPaths(messageId)).toStrictEqual(["Receipts"]);
  });

  it("reports spam but leaves the user's reply in Sent, then brings it back", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
    server.deliver("INBOX", genericMessage("h"));
    server.deliver(
      "Sent Messages",
      genericMessage("i", {
        envelope: envelope({
          inReplyTo: "<h@example.com>",
          messageId: "<i@example.com>",
          subject: "i",
        }),
        headers: { references: "<h@example.com>" },
      })
    );
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    const received = genericIds("h");
    const reply = genericIds("i");
    const copies = () => ({
      received: locationPaths(received.message_id),
      reply: locationPaths(reply.message_id),
    });
    expect(reply.thread_id).toBe(received.thread_id);

    await act(scope, received.thread_id, { kind: "moveToSpam" });
    expect(copies()).toStrictEqual({
      received: ["Junk"],
      reply: ["Sent Messages"],
    });
    expect(threadRow(received.thread_id)).toMatchObject({
      is_in_inbox: 0,
      is_in_spam: 1,
    });

    await act(scope, received.thread_id, { kind: "moveToInbox" });
    expect(copies()).toStrictEqual({
      received: ["INBOX"],
      reply: ["Sent Messages"],
    });
  });

  it("refuses to report a conversation of only the user's own mail", async () => {
    const { scope, server } = await syncIcloud([
      { id: "j", path: "Sent Messages" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("j");

    await expect(
      act(scope, threadId, { kind: "moveToSpam" })
    ).rejects.toMatchObject({ _tag: "MailProtocolError" });
    expect(
      server.calls.filter((call) => call.startsWith("move"))
    ).toStrictEqual([]);
    expect(locationPaths(messageId)).toStrictEqual(["Sent Messages"]);
  });

  it("puts the user's reply back in Sent when Trash is undone", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
    server.deliver("INBOX", genericMessage("k"));
    server.deliver("Sent Messages", genericReply("l", "k"));
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    const received = genericIds("k");
    const reply = genericIds("l");
    const copies = () => [
      locationPaths(received.message_id),
      locationPaths(reply.message_id),
    ];

    await act(scope, received.thread_id, { kind: "trash" });
    const trashed = copies();
    await act(scope, received.thread_id, { kind: "moveToInbox" });

    expect({ restored: copies(), trashed }).toStrictEqual({
      restored: [["INBOX"], ["Sent Messages"]],
      trashed: [["Deleted Messages"], ["Deleted Messages"]],
    });
  });

  it("puts a conversation of only sent mail back in Sent", async () => {
    const { scope } = await syncIcloud([{ id: "m", path: "Sent Messages" }]);
    const { message_id: messageId, thread_id: threadId } = genericIds("m");

    await act(scope, threadId, { kind: "trash" });
    await act(scope, threadId, { kind: "moveToInbox" });

    expect(locationPaths(messageId)).toStrictEqual(["Sent Messages"]);
    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 0,
      is_in_sent: 1,
    });
  });

  it("gives each copy of one message its own way back", async () => {
    // Mail to oneself, or a list echoing a post: one Message-ID, two copies.
    const { scope } = await syncIcloud([
      { id: "n", path: "INBOX" },
      { id: "n", path: "Sent Messages" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("n");

    await act(scope, threadId, { kind: "trash" });
    await act(scope, threadId, { kind: "moveToInbox" });

    expect(locationPaths(messageId)).toStrictEqual(["INBOX", "Sent Messages"]);
  });

  it("puts a labelled message's copies back in the Inbox and its folder", async () => {
    // Both copies went to Trash. Restored into the Inbox alike, they would
    // be two copies there and none in the folder: a duplicate, and the label
    // lost.
    const { scope } = await syncIcloud([
      { id: "t", path: "INBOX" },
      { id: "t", path: "Receipts" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("t");

    await act(scope, threadId, { kind: "trash" });
    await act(scope, threadId, { kind: "moveToInbox" });

    expect(locationPaths(messageId)).toStrictEqual(["INBOX", "Receipts"]);
    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      label_ids: JSON.stringify(["INBOX", "u:Receipts"]),
    });
  });

  it.each([
    { from: "Receipts", name: "filed only in a folder" },
    { from: "Archive", name: "archived" },
  ])(
    "puts mail $name back where it was, not in the Inbox",
    async ({ from }) => {
      const { scope } = await syncIcloud([{ id: "u", path: from }]);
      const { message_id: messageId, thread_id: threadId } = genericIds("u");

      await act(scope, threadId, { kind: "trash" });
      await act(scope, threadId, { kind: "moveToInbox" });

      expect(locationPaths(messageId)).toStrictEqual([from]);
      expect(threadRow(threadId)).toMatchObject({ is_in_inbox: 0 });
    }
  );

  it("restores mail trashed out of Spam to the Inbox, never back to Spam", async () => {
    const { scope } = await syncIcloud([{ id: "v", path: "Junk" }]);
    const { message_id: messageId, thread_id: threadId } = genericIds("v");

    await act(scope, threadId, { kind: "trash" });
    await act(scope, threadId, { kind: "moveToInbox" });

    expect(locationPaths(messageId)).toStrictEqual(["INBOX"]);
  });

  it("leaves a copy that was in Trash before there when Trash is undone", async () => {
    // The same mail delivered twice, with one copy deleted elsewhere. Trash
    // takes the Inbox copy, and its Undo must bring back that one alone:
    // restoring both would put two copies in the Inbox.
    const { scope } = await syncIcloud([
      { id: "w", path: "Deleted Messages" },
      { id: "w", path: "INBOX" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("w");
    const uidsInTrash = () =>
      (
        connection
          .prepare(
            "SELECT uid FROM mail_message_locations WHERE message_id = ? AND mailbox_path = 'Deleted Messages' ORDER BY uid"
          )
          .all(messageId) as { uid: number }[]
      ).map((row) => row.uid);

    await act(scope, threadId, { kind: "trash" });
    const trashed = uidsInTrash();
    await act(scope, threadId, { kind: "moveToInbox" });

    expect({
      copies: locationPaths(messageId),
      inTrash: uidsInTrash(),
      trashed,
    }).toStrictEqual({
      copies: ["Deleted Messages", "INBOX"],
      // The copy Trash took got the higher UID, and is the one that left.
      inTrash: [1],
      trashed: [1, 2],
    });
  });

  it("restores to the Inbox when the remembered mailbox is gone", async () => {
    const { scope, server } = await syncIcloud([
      { id: "s", path: "Sent Messages" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("s");
    await act(scope, threadId, { kind: "trash" });
    server.removeMailbox("Sent Messages");
    await run(syncAccount(scope));

    await act(scope, threadId, { kind: "moveToInbox" });

    expect(locationPaths(messageId)).toStrictEqual(["INBOX"]);
  });

  it("forgets where a copy was once it is trashed again from elsewhere", async () => {
    const { scope, server } = await syncIcloud([
      { id: "p", path: "Sent Messages" },
    ]);
    const { message_id: messageId, thread_id: threadId } = genericIds("p");
    await act(scope, threadId, { kind: "trash" });
    // Another mail app files it in the Inbox; Kisa then trashes it from there.
    const { uid } = connection
      .prepare(
        "SELECT uid FROM mail_message_locations WHERE message_id = ? AND mailbox_path = 'Deleted Messages'"
      )
      .get(messageId) as { uid: number };
    server.move("Deleted Messages", uid, "INBOX");
    await run(syncAccount(scope));
    await act(scope, threadId, { kind: "trash" });

    await act(scope, threadId, { kind: "moveToInbox" });

    expect(locationPaths(messageId)).toStrictEqual(["INBOX"]);
  });

  it("sets apart a conversation of only the user's own mail for Report spam", async () => {
    await syncIcloud([
      { id: "q", path: "INBOX" },
      { id: "r", path: "Sent Messages" },
    ]);
    const received = ThreadId.make(genericIds("q").thread_id);
    const own = ThreadId.make(genericIds("r").thread_id);
    const uncached = ThreadId.make("not-cached");

    await expect(
      run(partitionReportableThreads(accountId, [received, own, uncached]))
    ).resolves.toStrictEqual({
      ownOnly: [own],
      reportable: [received, uncached],
    });
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
