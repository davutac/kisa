import type { gmail_v1 } from "@googleapis/gmail";
import { describe, expect, it } from "vitest";

import { collectHistoryIds } from "../src/main/mail/gmail-gateway";

const collect = (records: readonly gmail_v1.Schema$History[]) => {
  const addedMessageIds = new Set<string>();
  const addedMessageIdsByThreadId = new Map<string, Set<string>>();
  const changedThreadIds = new Set<string>();
  const removedThreadIds = new Set<string>();

  collectHistoryIds(records, {
    addedMessageIds,
    addedMessageIdsByThreadId,
    changedThreadIds,
    removedThreadIds,
  });

  return {
    addedMessageIds: [...addedMessageIds],
    addedMessageIdsByThreadId: [...addedMessageIdsByThreadId].map(
      ([threadId, messageIds]) => [threadId, [...messageIds]]
    ),
    changedThreadIds: [...changedThreadIds],
    removedThreadIds: [...removedThreadIds],
  };
};

describe(collectHistoryIds, () => {
  it("separates new messages from ordinary label changes", () => {
    expect(
      collect([
        {
          labelsAdded: [{ message: { id: "existing", threadId: "thread-1" } }],
          messagesAdded: [{ message: { id: "new", threadId: "thread-2" } }],
        },
      ])
    ).toStrictEqual({
      addedMessageIds: ["new"],
      addedMessageIdsByThreadId: [["thread-2", ["new"]]],
      changedThreadIds: ["thread-2", "thread-1"],
      removedThreadIds: [],
    });
  });

  it("deduplicates replayed message-added history records", () => {
    expect(
      collect([
        { messagesAdded: [{ message: { id: "new", threadId: "thread-1" } }] },
        { messagesAdded: [{ message: { id: "new", threadId: "thread-1" } }] },
      ])
    ).toStrictEqual({
      addedMessageIds: ["new"],
      addedMessageIdsByThreadId: [["thread-1", ["new"]]],
      changedThreadIds: ["thread-1"],
      removedThreadIds: [],
    });
  });
});
