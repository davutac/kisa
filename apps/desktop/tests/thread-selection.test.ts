import { describe, expect, it } from "@effect/vitest";

import {
  getNextThreadSelectionIndex,
  getThreadSelectionKey,
  getVisibleThreadSelectionIndex,
  parseThreadSelectionKey,
} from "../src/renderer/src/mail/thread-selection";

const threadKeys = ["account:first", "account:second", "account:third"];

const rows = Array.from({ length: 10 }, (_unused, index) => ({
  end: (index + 1) * 100,
  index,
  start: index * 100,
}));

describe(getNextThreadSelectionIndex, () => {
  it("starts at the edge matching the navigation direction", () => {
    expect(getNextThreadSelectionIndex(threadKeys, null, 1)).toBe(0);
    expect(getNextThreadSelectionIndex(threadKeys, null, -1)).toBe(2);
  });

  it("moves from the current selection and stops at the list edges", () => {
    expect(getNextThreadSelectionIndex(threadKeys, "account:second", 1)).toBe(
      2
    );
    expect(getNextThreadSelectionIndex(threadKeys, "account:second", -1)).toBe(
      0
    );
    expect(getNextThreadSelectionIndex(threadKeys, "account:first", -1)).toBe(
      0
    );
    expect(getNextThreadSelectionIndex(threadKeys, "account:third", 1)).toBe(2);
  });

  it("treats a stale selection like no selection", () => {
    expect(getNextThreadSelectionIndex(threadKeys, "missing", 1)).toBe(0);
    expect(getNextThreadSelectionIndex(threadKeys, "missing", -1)).toBe(2);
  });

  it("does not select anything in an empty list", () => {
    expect(getNextThreadSelectionIndex([], null, 1)).toBeNull();
  });
});

describe(getVisibleThreadSelectionIndex, () => {
  it("anchors on the row at the edge the navigation comes from", () => {
    expect(getVisibleThreadSelectionIndex(rows, 300, 700, 1)).toBe(3);
    expect(getVisibleThreadSelectionIndex(rows, 300, 700, -1)).toBe(6);
  });

  it("skips a row whose midpoint is clipped by the viewport", () => {
    expect(getVisibleThreadSelectionIndex(rows, 260, 740, 1)).toBe(3);
    expect(getVisibleThreadSelectionIndex(rows, 260, 740, -1)).toBe(6);
  });

  it("ignores rows rendered outside the viewport as overscan", () => {
    const overscan = rows.slice(1, 8);

    expect(getVisibleThreadSelectionIndex(overscan, 300, 700, 1)).toBe(3);
    expect(getVisibleThreadSelectionIndex(overscan, 300, 700, -1)).toBe(6);
  });

  it("has no anchor when nothing is in view", () => {
    expect(getVisibleThreadSelectionIndex([], 0, 500, 1)).toBeNull();
    expect(getVisibleThreadSelectionIndex(rows, 5000, 5400, 1)).toBeNull();
  });
});

describe(parseThreadSelectionKey, () => {
  it("round-trips a selection key", () => {
    const thread = { accountId: "person@example.com", threadId: "thread-42" };

    expect(
      parseThreadSelectionKey(getThreadSelectionKey(thread))
    ).toStrictEqual(thread);
  });

  it("keeps colons that belong to the thread id", () => {
    expect(parseThreadSelectionKey("person@example.com:a:b")).toStrictEqual({
      accountId: "person@example.com",
      threadId: "a:b",
    });
  });

  it("rejects keys that are not a pair", () => {
    expect(parseThreadSelectionKey("")).toBeNull();
    expect(parseThreadSelectionKey("no-separator")).toBeNull();
    expect(parseThreadSelectionKey(":thread-42")).toBeNull();
    expect(parseThreadSelectionKey("person@example.com:")).toBeNull();
  });
});
