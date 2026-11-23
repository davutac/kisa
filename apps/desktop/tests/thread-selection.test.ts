import { describe, expect, it } from "@effect/vitest";

import {
  getSelectionAfterRemoval,
  getThreadSelectionScrollBehavior,
  getThreadSelectionKey,
  getVisibleThreadSelectionIndex,
  parseThreadSelectionKey,
} from "../src/renderer/src/mail/thread-selection";

const rows = Array.from({ length: 10 }, (_unused, index) => ({
  end: (index + 1) * 100,
  index,
  start: index * 100,
}));

describe(getThreadSelectionScrollBehavior, () => {
  it("smoothly centers ordinary moves and keeps rapid repeats responsive", () => {
    expect({
      first: getThreadSelectionScrollBehavior(null, 1000),
      rapid: getThreadSelectionScrollBehavior(1000, 1149),
      settled: getThreadSelectionScrollBehavior(1000, 1150),
    }).toStrictEqual({ first: "smooth", rapid: "auto", settled: "smooth" });
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

describe(getSelectionAfterRemoval, () => {
  const before = ["a:1", "a:2", "a:3", "a:4"];

  it("selects the row that takes the removed one's place", () => {
    expect(getSelectionAfterRemoval(before, ["a:1", "a:3", "a:4"], "a:2")).toBe(
      "a:3"
    );
  });

  it("skips rows removed with it, and falls back to the row before at the end", () => {
    expect(getSelectionAfterRemoval(before, ["a:1", "a:4"], "a:2")).toBe("a:4");
    expect(getSelectionAfterRemoval(before, ["a:1", "a:2"], "a:4")).toBe("a:2");
  });

  it("keeps a selection that is still listed, or that never was", () => {
    expect(getSelectionAfterRemoval(before, before, "a:2")).toBeUndefined();
    expect(getSelectionAfterRemoval(before, before, "b:9")).toBeUndefined();
    expect(getSelectionAfterRemoval(before, before, null)).toBeUndefined();
  });

  it("leaves nothing selected when the list empties", () => {
    expect(getSelectionAfterRemoval(["a:1"], [], "a:1")).toBeUndefined();
  });
});
