import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  loadOpenThread,
  toOpenThreadUpdate,
} from "../src/renderer/src/mail/open-thread-update";
import { MailThreadLoadRequest } from "../src/shared/ipc/mail";
import type {
  MailThreadReply,
  MailThreadSummary,
} from "../src/shared/ipc/mail";

const summary = (
  overrides: Partial<MailThreadSummary> = {}
): MailThreadSummary => ({
  accountId: "a@example.com",
  attachments: [],
  from: "sender@example.com",
  hasAttachments: false,
  isUnread: false,
  labels: ["INBOX"],
  latestAt: 1,
  messageCount: 2,
  places: ["inbox"],
  snippet: "",
  subject: "Hello",
  threadId: "t1",
  ...overrides,
});

const open = {
  accountId: "a@example.com",
  shownMessageCount: 2,
  threadId: "t1",
};

describe("an open conversation's list updates", () => {
  it("rereads the conversation when a message arrived or was sent", () => {
    expect(
      toOpenThreadUpdate(
        [{ kind: "upsert", thread: summary({ messageCount: 3 }) }],
        open
      )
    ).toStrictEqual({ kind: "reread" });
  });

  it("only moves the labels when the messages are the same", () => {
    expect(
      toOpenThreadUpdate(
        [
          {
            kind: "upsert",
            thread: summary({
              labels: ["INBOX", "STARRED"],
              places: ["inbox", "starred"],
            }),
          },
        ],
        open
      )
    ).toStrictEqual({
      kind: "labels",
      labels: ["INBOX", "STARRED"],
      places: ["inbox", "starred"],
    });
  });

  it("follows the last summary when one update names the thread twice", () => {
    expect(
      toOpenThreadUpdate(
        [
          { kind: "upsert", thread: summary({ messageCount: 3 }) },
          { kind: "upsert", thread: summary({ labels: [], places: [] }) },
        ],
        open
      )
    ).toStrictEqual({ kind: "labels", labels: [], places: [] });
  });

  it("ignores the same thread id in another account, and other threads", () => {
    expect(
      toOpenThreadUpdate(
        [
          {
            kind: "upsert",
            thread: summary({ accountId: "b@example.com", messageCount: 9 }),
          },
          {
            kind: "upsert",
            thread: summary({ messageCount: 9, threadId: "t2" }),
          },
          { accountId: "a@example.com", kind: "remove", threadId: "t1" },
        ],
        open
      )
    ).toBeUndefined();
  });

  it("does not reread before the conversation was first read", () => {
    expect(
      toOpenThreadUpdate(
        [{ kind: "upsert", thread: summary({ messageCount: 3 }) }],
        { ...open, shownMessageCount: undefined }
      )
    ).toStrictEqual({ kind: "labels", labels: ["INBOX"], places: ["inbox"] });
  });
});

const threadReply = (awaitsServer: boolean): MailThreadReply => ({
  data: {
    accountId: "a@example.com",
    awaitsServer,
    labels: [],
    messages: [],
    places: [],
    subject: awaitsServer ? "From the cache" : "In full",
    threadId: "1",
  },
  ok: true,
});

const subjectOf = (reply: MailThreadReply): string =>
  reply.ok ? reply.data.subject : reply.error;

describe(loadOpenThread, () => {
  it("shows the cache's answer, then the full load it says is owed", async () => {
    const reads: boolean[] = [];
    const shown: string[] = [];

    await loadOpenThread({
      isShown: () => true,
      read: (cachedOnly) => {
        reads.push(cachedOnly);
        return Promise.resolve(threadReply(cachedOnly));
      },
      show: (reply) => shown.push(subjectOf(reply)),
    });

    expect(reads).toStrictEqual([true, false]);
    expect(shown).toStrictEqual(["From the cache", "In full"]);
  });

  it("stops at the cache when nothing is owed or the read failed", async () => {
    const reads: boolean[] = [];
    const read = (reply: MailThreadReply) => (cachedOnly: boolean) => {
      reads.push(cachedOnly);
      return Promise.resolve(reply);
    };

    const shown: string[] = [];
    const show = (reply: MailThreadReply) => shown.push(subjectOf(reply));

    await loadOpenThread({
      isShown: () => true,
      read: read(threadReply(false)),
      show,
    });
    await loadOpenThread({
      isShown: () => true,
      read: read({ error: "Could not load email", ok: false }),
      show,
    });

    expect(reads).toStrictEqual([true, true]);
    expect(shown).toStrictEqual(["In full", "Could not load email"]);
  });

  it("still loads in full once closed, so an opened conversation is read", async () => {
    const reads: boolean[] = [];
    const shown: string[] = [];
    let isShown = true;

    await loadOpenThread({
      isShown: () => isShown,
      read: (cachedOnly) => {
        reads.push(cachedOnly);
        isShown = false;
        return Promise.resolve(threadReply(cachedOnly));
      },
      show: (reply) => shown.push(subjectOf(reply)),
    });

    expect(reads).toStrictEqual([true, false]);
    expect(shown).toStrictEqual([]);
  });
});

describe("the request that loads a conversation", () => {
  const decode = Schema.decodeUnknownSync(MailThreadLoadRequest);

  it("loads in full unless asked for the cache alone", () => {
    expect(decode({ accountId: "a@example.com", threadId: "1" })).toStrictEqual(
      { accountId: "a@example.com", threadId: "1" }
    );
    expect(
      decode({ accountId: "a@example.com", cachedOnly: true, threadId: "1" })
    ).toStrictEqual({
      accountId: "a@example.com",
      cachedOnly: true,
      threadId: "1",
    });
  });

  it("refuses anything but a boolean for the cache alone", () => {
    expect(() =>
      decode({ accountId: "a@example.com", cachedOnly: "yes", threadId: "1" })
    ).toThrow("Expected boolean");
  });
});
