// oxlint-disable typescript/no-unsafe-type-assertion
// A conversation with one message in Trash and another outside it: mail that
// arrived after the conversation was trashed. Gmail lists it in the Inbox by
// the new message, and so must Kisa, or the mail is never seen.
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { ThreadId, userLabelId } from "@repo/mail/ids";
import { applyThreadAction } from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import { MailEngineStore } from "@repo/mail/store";
import { syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import {
  readConversation,
  readThreadSummaries,
} from "../src/main/mail/engine/mail-reads";
import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  accountId,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  messageRow,
  remoteDatabase,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";
import { found, stringList } from "./fixtures/rows";

const act = (scope: SyncScope, threadId: string, action: ThreadAction) =>
  run(applyThreadAction(scope, [ThreadId.make(threadId)], action));

const relist = () =>
  run(
    Effect.gen(function* relistHidden() {
      const store = yield* MailEngineStore;

      return yield* store.relistHidden(accountId);
    })
  );

const labelsOf = (threadId: string): readonly string[] =>
  stringList(threadRow(threadId)?.label_ids ?? "[]");

/** The places main sends with the conversation, which a window lists it by. */
const placesOf = async (threadId: string): Promise<readonly string[]> => {
  const [summary] = await readThreadSummaries(remoteDatabase, accountId, [
    threadId,
  ]);

  return summary?.places ?? [];
};

const shownMessages = async (threadId: string): Promise<number> => {
  const conversation = await readConversation(
    remoteDatabase,
    accountId,
    threadId
  );

  return conversation?.messages.length ?? 0;
};

/** Conversation 400, trashed in Kisa, with nothing arrived since. */
const trashedConversation = async () => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES, undefined, ALL_MAIL);
  server.deliver(ALL_MAIL, gmailMessage("400", "400"));
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  await act(scope, "400", { kind: "trash" });

  return { scope, server };
};

/** The same, after an unread message arrived in the conversation. */
const trashedThenAnswered = async () => {
  const { scope, server } = await trashedConversation();
  server.deliver(ALL_MAIL, gmailMessage("401", "400", { flags: [] }));
  await run(syncAccount(scope));

  return { scope, server };
};

describe("a conversation with mail in Trash and mail outside it", () => {
  beforeEach(resetDatabase);

  it("is listed in the Inbox by the mail outside Trash", async () => {
    await trashedThenAnswered();

    expect(threadRow("400")).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      is_unread: 1,
      message_count: 1,
    });
    expect(labelsOf("400")).not.toContain("TRASH");
    // A window lists the conversation, and offers Delete forever for it, by
    // these alone.
    await expect(placesOf("400")).resolves.toStrictEqual(["inbox"]);
  });

  it("is filed under Trash with all of it once the rest is trashed too", async () => {
    const { scope } = await trashedThenAnswered();

    await act(scope, "400", { kind: "trash" });

    expect(threadRow("400")).toMatchObject({
      is_in_trash: 1,
      message_count: 2,
    });
    await expect(placesOf("400")).resolves.toStrictEqual(["trash"]);
  });

  it("opens with the messages its row lists", async () => {
    const { scope } = await trashedThenAnswered();
    await expect(shownMessages("400")).resolves.toBe(1);

    await act(scope, "400", { kind: "trash" });
    await expect(shownMessages("400")).resolves.toBe(2);
  });

  // Undo of the first Trash, pressed after the new mail arrived.
  it("gets the trashed message back when it is restored", async () => {
    const { scope } = await trashedThenAnswered();

    await act(scope, "400", { kind: "moveToInbox" });

    expect(labelsOf("400")).not.toContain("TRASH");
    expect(JSON.parse(messageRow("400")?.label_ids ?? "[]")).not.toContain(
      "TRASH"
    );
    expect(threadRow("400")).toMatchObject({ message_count: 2 });
  });
});

describe("a reported conversation that gets mail in the Inbox", () => {
  beforeEach(resetDatabase);

  it("is listed in the Inbox by that mail, and under Spam again without it", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES, undefined, ALL_MAIL);
    server.deliver(ALL_MAIL, gmailMessage("500", "500"));
    const scope = scopeFor(server, gmailDialect);
    await syncFully(scope);
    await act(scope, "500", { kind: "moveToSpam" });
    expect(threadRow("500")).toMatchObject({ is_in_spam: 1 });

    server.deliver(ALL_MAIL, gmailMessage("501", "500", { flags: [] }));
    await run(syncAccount(scope));
    expect(threadRow("500")).toMatchObject({
      is_in_inbox: 1,
      is_in_spam: 0,
      message_count: 1,
    });

    await act(scope, "500", { kind: "moveToSpam" });
    expect(threadRow("500")).toMatchObject({
      is_in_spam: 1,
      message_count: 2,
    });
  });
});

describe("listing again what an earlier build filed under Trash", () => {
  beforeEach(resetDatabase);

  it("puts a conversation with mail outside Trash back in the Inbox", async () => {
    await trashedThenAnswered();
    // The row as it was written before the rule.
    connection
      .prepare(
        "UPDATE mail_threads SET is_in_trash = 1, message_count = 2 WHERE thread_id = '400'"
      )
      .run();

    const changes = await relist();

    expect(changes.changed).toStrictEqual(["400"]);
    expect(threadRow("400")).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      message_count: 1,
    });
    await expect(relist()).resolves.toMatchObject({ changed: [] });
  });

  it("leaves a conversation that is in Trash altogether where it is", async () => {
    await trashedConversation();

    await expect(relist()).resolves.toMatchObject({ changed: [] });
    expect(threadRow("400")).toMatchObject({ is_in_trash: 1 });
  });
});

describe("labelling such a conversation outside Gmail", () => {
  beforeEach(resetDatabase);

  // A label is a folder there, and labelling copies a message into it.
  // Copying the trashed message would bring it back.
  it("files the message outside Trash, and leaves the trashed one in Trash", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
    server.deliver("INBOX", genericMessage("first"));
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);

    const { thread_id: threadId } = found(
      connection
        .prepare<unknown[], { thread_id: string }>(
          "SELECT thread_id FROM mail_messages WHERE subject = 'first'"
        )
        .get()
    );

    await act(scope, threadId, { kind: "trash" });
    server.deliver(
      "INBOX",
      genericMessage("reply", {
        envelope: envelope({
          inReplyTo: "<first@example.com>",
          messageId: "<reply@example.com>",
          subject: "reply",
        }),
        headers: { references: "<first@example.com>" },
      })
    );
    await run(syncAccount(scope));

    await act(scope, threadId, {
      applied: true,
      kind: "setLabel",
      labelId: userLabelId("Receipts"),
    });

    expect(
      server.calls.filter((call) => call.startsWith("copy"))
    ).toStrictEqual(["copy INBOX -> Receipts"]);
    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      message_count: 1,
    });
  });
});

/** The cached ids of the generic message with this subject. */
const idsOf = (subject: string) =>
  found(
    connection
      .prepare<unknown[], { message_id: string; thread_id: string }>(
        "SELECT message_id, thread_id FROM mail_messages WHERE subject = ?"
      )
      .get(subject)
  );

/** The same mail delivered twice, with one copy deleted elsewhere. */
const twiceDelivered = async (discarded: string) => {
  insertAccount("generic");
  const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
  server.deliver("INBOX", genericMessage("twice", { flags: [] }));
  server.deliver(discarded, genericMessage("twice"));
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);

  return { ...idsOf("twice"), scope, server };
};

// One Message-ID in two mailboxes is one message with two copies. A copy in
// Trash must not file the copy in the Inbox there with it.
describe("a message with one copy in Trash and another outside it", () => {
  beforeEach(resetDatabase);

  it.each(["Deleted Messages", "Junk"])(
    "is listed in the Inbox by its copy there, beside one in %s",
    async (discarded) => {
      const { message_id: messageId, thread_id: threadId } =
        await twiceDelivered(discarded);

      expect(threadRow(threadId)).toMatchObject({
        is_in_inbox: 1,
        is_in_spam: 0,
        is_in_trash: 0,
        is_unread: 1,
        message_count: 1,
      });
      expect(
        JSON.parse(messageRow(messageId)?.label_ids ?? "[]")
      ).toStrictEqual(["INBOX", "UNREAD"]);
      await expect(placesOf(threadId)).resolves.toStrictEqual(["inbox"]);
    }
  );

  it("is filed under Trash once its Inbox copy is trashed too", async () => {
    const { scope, thread_id: threadId } =
      await twiceDelivered("Deleted Messages");

    await act(scope, threadId, { kind: "trash" });

    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 0,
      is_in_trash: 1,
    });
  });

  it("is listed again when an earlier build filed it under Trash", async () => {
    const { message_id: messageId, thread_id: threadId } =
      await twiceDelivered("Deleted Messages");

    // The rows as they were written when a message carried the labels of
    // every copy.
    connection
      .prepare(
        `UPDATE mail_messages SET label_ids = '["INBOX","TRASH"]', is_unread = 0
         WHERE message_id = ?`
      )
      .run(messageId);
    connection
      .prepare(
        "UPDATE mail_threads SET is_in_trash = 1, is_unread = 0 WHERE thread_id = ?"
      )
      .run(threadId);

    const changes = await relist();

    expect(changes.changed).toStrictEqual([threadId]);
    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      is_unread: 1,
    });
    await expect(relist()).resolves.toMatchObject({ changed: [] });
  });

  it("is listed again beside mail that already listed its conversation", async () => {
    const {
      message_id: messageId,
      scope,
      server,
      thread_id: threadId,
    } = await twiceDelivered("Deleted Messages");

    server.deliver(
      "INBOX",
      genericMessage("answer", {
        envelope: envelope({
          inReplyTo: "<twice@example.com>",
          messageId: "<answer@example.com>",
          subject: "answer",
        }),
        headers: { references: "<twice@example.com>" },
      })
    );
    await run(syncAccount(scope));
    // Under the old rule the answer alone listed the conversation, which
    // was in the Inbox already: no row under Trash leads to this message.
    connection
      .prepare(
        `UPDATE mail_messages SET label_ids = '["INBOX","TRASH"]'
         WHERE message_id = ?`
      )
      .run(messageId);
    connection
      .prepare("UPDATE mail_threads SET message_count = 1 WHERE thread_id = ?")
      .run(threadId);

    const changes = await relist();

    expect(changes.changed).toStrictEqual([threadId]);
    expect(threadRow(threadId)).toMatchObject({
      is_in_inbox: 1,
      message_count: 2,
    });
    await expect(relist()).resolves.toMatchObject({ changed: [] });
  });
});
