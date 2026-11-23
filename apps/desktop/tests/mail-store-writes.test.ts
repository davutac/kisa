// The store's bulk writes, read back as SQLite holds them: one statement per
// batch must store exactly what one statement per row did.
// oxlint-disable typescript/no-unsafe-type-assertion
import { LabelId, MessageId, SystemLabel, ThreadId } from "@repo/mail/ids";
import { MailEngineStore } from "@repo/mail/store";
import type { MailboxBatch, MessageMetadata } from "@repo/mail/store";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import {
  ALL_MAIL,
  accountId,
  connection,
  insertAccount,
  messageRow,
  resetDatabase,
  run,
  threadRow,
} from "./fixtures/mail-engine-harness";

const store = <A>(
  use: (service: MailEngineStore["Service"]) => Effect.Effect<A, unknown>
) =>
  run(
    Effect.gen(function* useStore() {
      return yield* use(yield* MailEngineStore);
    }) as Effect.Effect<A, never, MailEngineStore>
  );

const metadata = (
  id: string,
  overrides: Partial<MessageMetadata> = {}
): MessageMetadata => ({
  bcc: [],
  cc: [],
  from: { address: `${id}@example.com`, name: `Sender ${id}` },
  messageId: MessageId.make(id),
  receivedAt: Number(id) * 1000,
  size: 100,
  subject: `Subject ${id}`,
  threadId: ThreadId.make(`t${id}`),
  to: ["me@example.com"],
  ...overrides,
});

/** One All Mail batch: message `id` at UID `id`, read unless named unread. */
const batch = (
  messages: readonly MessageMetadata[],
  unread: readonly string[] = []
): MailboxBatch => ({
  locations: messages.map((message) => ({
    flags: unread.includes(message.messageId) ? [] : ["\\Seen"],
    labelIds: unread.includes(message.messageId)
      ? [SystemLabel.inbox, SystemLabel.unread]
      : [SystemLabel.inbox],
    messageId: message.messageId,
    uid: Number(message.messageId),
  })),
  messages,
  path: ALL_MAIL,
  progress: {},
  uidValidity: 1n,
});

describe("the mail store's bulk writes", () => {
  beforeEach(() => {
    resetDatabase();
    insertAccount("gmail");
  });

  describe("writing a batch of mail", () => {
    it("stores every value as its column holds it", async () => {
      const awkward = metadata("1", {
        cc: ["a@example.com", "b@example.com"],
        from: {
          address: "o'brien@example.com",
          name: 'Ünïcødé "quoted" \\ 🙂',
        },
        inReplyTo: "<parent@example.com>",
        sentAt: 1_700_000_000_123,
        subject: "Line one\nline two — 50% off; DROP TABLE mail_messages; --",
      });

      await store((service) =>
        service.applyMailboxBatch(accountId, batch([awkward], ["1"]))
      );

      const row = connection
        .prepare(
          `SELECT subject, from_name, from_address, cc_addresses, in_reply_to,
                  sent_at, typeof(sent_at) AS sent_type, is_unread, is_starred,
                  label_ids, first_reference
           FROM mail_messages WHERE message_id = '1'`
        )
        .get();
      expect(row).toStrictEqual({
        cc_addresses: JSON.stringify(["a@example.com", "b@example.com"]),
        first_reference: null,
        from_address: "o'brien@example.com",
        from_name: 'Ünïcødé "quoted" \\ 🙂',
        in_reply_to: "<parent@example.com>",
        is_starred: 0,
        is_unread: 1,
        label_ids: JSON.stringify([SystemLabel.inbox, SystemLabel.unread]),
        sent_at: 1_700_000_000_123,
        sent_type: "integer",
        subject: "Line one\nline two — 50% off; DROP TABLE mail_messages; --",
      });
      expect(threadRow("t1")).toMatchObject({
        is_in_inbox: 1,
        is_unread: 1,
        message_count: 1,
        subject: "Line one\nline two — 50% off; DROP TABLE mail_messages; --",
      });
    });

    it("stores text a sender controls as binding it directly did", async () => {
      // A NUL and a lone surrogate, both possible in a decoded header.
      const subject = "before\u0000after \uD800 end";
      await store((service) =>
        service.applyMailboxBatch(
          accountId,
          batch([
            metadata("1", {
              from: { address: "a@example.com", name: subject },
              subject,
            }),
          ])
        )
      );

      const direct = connection.prepare("SELECT ? AS subject").get(subject) as {
        readonly subject: string;
      };
      expect(messageRow("1")).toMatchObject({ thread_id: "t1" });
      expect(
        connection
          .prepare(
            "SELECT subject, from_name AS fromName FROM mail_messages WHERE message_id = '1'"
          )
          .get()
      ).toStrictEqual({ fromName: direct.subject, subject: direct.subject });
    });

    it("keeps a stored body when the same message is written again", async () => {
      const message = metadata("1");
      await store((service) =>
        service.applyMailboxBatch(accountId, batch([message]))
      );
      await store((service) =>
        service.saveBodies(accountId, [
          { headers: [], messageId: message.messageId, text: "The body" },
        ])
      );

      await store((service) =>
        service.applyMailboxBatch(
          accountId,
          batch([{ ...message, subject: "Renamed" }])
        )
      );

      expect(messageRow("1")).toMatchObject({
        body_state: "ready",
        body_text: "The body",
        snippet: "The body",
      });
      expect(threadRow("t1")).toMatchObject({
        snippet: "The body",
        subject: "Renamed",
      });
    });
  });

  describe("re-reading flags", () => {
    it("ends a copy reported twice as its last report says", async () => {
      await store((service) =>
        service.applyMailboxBatch(accountId, batch([metadata("1")]))
      );

      await store((service) =>
        service.applyLocationChanges(
          accountId,
          ALL_MAIL,
          [
            {
              flags: ["\\Flagged"],
              labelIds: [SystemLabel.inbox, SystemLabel.unread],
              uid: 1,
            },
            {
              flags: ["\\Seen", "\\Flagged"],
              labelIds: [SystemLabel.inbox, LabelId.make("STARRED")],
              modseq: 9n,
              uid: 1,
            },
          ],
          {}
        )
      );

      expect(
        connection
          .prepare(
            "SELECT flags, label_ids, modseq FROM mail_message_locations WHERE uid = 1"
          )
          .get()
      ).toStrictEqual({
        flags: JSON.stringify(["\\Seen", "\\Flagged"]),
        label_ids: JSON.stringify([SystemLabel.inbox, SystemLabel.starred]),
        modseq: "9",
      });
      expect(messageRow("1")).toMatchObject({ is_unread: 0 });
    });

    it("records a new mod-sequence on a copy that did not change", async () => {
      await store((service) =>
        service.applyMailboxBatch(accountId, batch([metadata("1")]))
      );

      const changes = await store((service) =>
        service.applyLocationChanges(
          accountId,
          ALL_MAIL,
          [
            {
              flags: ["\\Seen"],
              labelIds: [SystemLabel.inbox],
              modseq: 12n,
              uid: 1,
            },
          ],
          {}
        )
      );

      expect(changes.changed).toStrictEqual([]);
      expect(
        connection
          .prepare("SELECT modseq FROM mail_message_locations WHERE uid = 1")
          .get()
      ).toStrictEqual({ modseq: "12" });
    });
  });

  describe("the body queue", () => {
    it("passes over messages left without a copy", async () => {
      await store((service) =>
        service.applyMailboxBatch(
          accountId,
          batch(["1", "2", "3", "4"].map((id) => metadata(id)))
        )
      );
      // The two newest lose their only copy; they stay until orphans are
      // collected, and must not stop older mail from being fetched.
      await store((service) =>
        service.removeLocations(accountId, ALL_MAIL, [3, 4])
      );

      const candidates = await store((service) =>
        service.bodyCandidates(accountId, { limit: 2 })
      );

      expect(candidates.map((candidate) => candidate.messageId)).toStrictEqual([
        "2",
        "1",
      ]);
      expect(candidates[0]).toMatchObject({ mailboxPath: ALL_MAIL, uid: 2 });
    });
  });
});
