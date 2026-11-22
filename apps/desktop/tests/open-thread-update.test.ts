import { describe, expect, it } from "vitest";

import { toOpenThreadUpdate } from "../src/renderer/src/mail/open-thread-update";
import type { MailThreadSummary } from "../src/shared/ipc/mail";

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
        [{ kind: "upsert", thread: summary({ labels: ["INBOX", "STARRED"] }) }],
        open
      )
    ).toStrictEqual({ kind: "labels", labels: ["INBOX", "STARRED"] });
  });

  it("follows the last summary when one update names the thread twice", () => {
    expect(
      toOpenThreadUpdate(
        [
          { kind: "upsert", thread: summary({ messageCount: 3 }) },
          { kind: "upsert", thread: summary({ labels: [] }) },
        ],
        open
      )
    ).toStrictEqual({ kind: "labels", labels: [] });
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
    ).toStrictEqual({ kind: "labels", labels: ["INBOX"] });
  });
});
