import { describe, expect, it } from "vitest";

import {
  planBulkThreadMutation,
  shouldBatchThreadMutation,
} from "../src/main/mail/bulk-mutation-quota";

describe(shouldBatchThreadMutation, () => {
  it("uses thread modify through the fixed-cost break-even point", () => {
    expect(shouldBatchThreadMutation("setReadState", 5)).toBeFalsy();
    expect(shouldBatchThreadMutation("setLabel", 6)).toBeTruthy();
  });

  it("batches trash once it costs less than thread trash calls", () => {
    expect(shouldBatchThreadMutation("trash", 2)).toBeFalsy();
    expect(shouldBatchThreadMutation("trash", 3)).toBeTruthy();
  });
});

describe(planBulkThreadMutation, () => {
  it("keeps batches within 1000 messages without splitting a thread", () => {
    expect(
      planBulkThreadMutation("setReadState", [160, 160, 160, 160, 160, 160, 50])
    ).toStrictEqual({
      batches: [[0, 1, 2, 3, 4, 5]],
      fallback: [6],
    });
  });

  it("falls back for unknown membership and oversized threads", () => {
    expect(
      planBulkThreadMutation("trash", [undefined, 1001, 1, 1, 1])
    ).toStrictEqual({
      batches: [[2, 3, 4]],
      fallback: [0, 1],
    });
  });

  it("never plans message-level permanent deletion", () => {
    expect(
      planBulkThreadMutation("deleteSpam", [1, 1, 1, 1, 1, 1])
    ).toStrictEqual({
      batches: [],
      fallback: [0, 1, 2, 3, 4, 5],
    });
  });

  it("keeps Undo mailbox moves on Gmail's whole-thread endpoint", () => {
    for (const kind of ["moveToInbox", "moveToSpam"] as const) {
      expect(planBulkThreadMutation(kind, [1, 1, 1, 1, 1, 1])).toStrictEqual({
        batches: [],
        fallback: [0, 1, 2, 3, 4, 5],
      });
    }
  });
});
