import { describe, expect, it } from "@effect/vitest";

import {
  getNextThreadSelectionIndex,
  getThreadSelectionAutoScrollDelta,
  getThreadSelectionRangeChanges,
  getThreadSelectionScrollBehavior,
  getThreadSelectionKey,
  getVisibleThreadSelectionIndex,
  hasThreadSelectionDragStarted,
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

describe(hasThreadSelectionDragStarted, () => {
  it("keeps movement below 15px as a normal click", () => {
    expect(
      hasThreadSelectionDragStarted({ x: 10, y: 10 }, { x: 19, y: 21 })
    ).toBeFalsy();
  });

  it("starts selection at the 15px tolerance", () => {
    expect(
      hasThreadSelectionDragStarted({ x: 10, y: 10 }, { x: 19, y: 22 })
    ).toBeTruthy();
  });
});

describe(getThreadSelectionRangeChanges, () => {
  const rangeThreadKeys = ["a", "b", "c", "d", "e"];

  it("selects every row crossed while extending the drag", () => {
    expect(
      getThreadSelectionRangeChanges(rangeThreadKeys, new Set(), 1, 1, 4, true)
    ).toStrictEqual([
      { checked: true, threadKey: "c" },
      { checked: true, threadKey: "d" },
      { checked: true, threadKey: "e" },
    ]);
  });

  it("restores original row states when the drag reverses", () => {
    expect(
      getThreadSelectionRangeChanges(
        rangeThreadKeys,
        new Set(["d"]),
        1,
        4,
        2,
        true
      )
    ).toStrictEqual([
      { checked: true, threadKey: "d" },
      { checked: false, threadKey: "e" },
    ]);
  });

  it("restores checked rows while reversing a deselection drag", () => {
    expect(
      getThreadSelectionRangeChanges(
        rangeThreadKeys,
        new Set(rangeThreadKeys),
        1,
        4,
        2,
        false
      )
    ).toStrictEqual([
      { checked: true, threadKey: "d" },
      { checked: true, threadKey: "e" },
    ]);
  });

  it("switches sides of the anchor in one movement", () => {
    expect(
      getThreadSelectionRangeChanges(rangeThreadKeys, new Set(), 2, 4, 0, true)
    ).toStrictEqual([
      { checked: true, threadKey: "a" },
      { checked: true, threadKey: "b" },
      { checked: false, threadKey: "d" },
      { checked: false, threadKey: "e" },
    ]);
  });
});

describe(getThreadSelectionAutoScrollDelta, () => {
  it("scrolls toward the nearest viewport edge", () => {
    expect(getThreadSelectionAutoScrollDelta(110, 100, 600)).toBeLessThan(0);
    expect(getThreadSelectionAutoScrollDelta(590, 100, 600)).toBeGreaterThan(0);
  });

  it("stays still away from the edge", () => {
    expect(getThreadSelectionAutoScrollDelta(300, 100, 600)).toBe(0);
  });

  it("caps the speed outside the viewport", () => {
    expect(getThreadSelectionAutoScrollDelta(0, 100, 600)).toBe(-18);
    expect(getThreadSelectionAutoScrollDelta(700, 100, 600)).toBe(18);
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
