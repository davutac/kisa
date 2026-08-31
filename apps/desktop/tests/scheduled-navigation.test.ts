import { afterEach, describe, expect, it, vi } from "vitest";

import {
  focusScheduledMailTarget,
  getScheduledMailSelectionIndex,
  useScheduledMailNavigation,
} from "../src/renderer/src/scheduled/scheduled-navigation";

describe("scheduled mail navigation", () => {
  afterEach(() => {
    useScheduledMailNavigation.getState().clear();
  });

  it("keeps an account-scoped editor target queued until it is cleared", () => {
    const target = {
      accountId: "person@example.com",
      draftId: "draft-1",
    };

    useScheduledMailNavigation.getState().requestOpen(target);
    expect(useScheduledMailNavigation.getState().target).toStrictEqual(target);

    useScheduledMailNavigation.getState().clear();
    expect(useScheduledMailNavigation.getState().target).toBeNull();
  });

  it("starts scheduled navigation inside the visible virtual rows", () => {
    const itemKeys = ["first", "visible-first", "visible-last", "last"];

    expect({
      fallbackDown: getScheduledMailSelectionIndex(itemKeys, null, null, 1),
      fallbackUp: getScheduledMailSelectionIndex(itemKeys, null, null, -1),
      visibleDown: getScheduledMailSelectionIndex(itemKeys, null, 1, 1),
      visibleUp: getScheduledMailSelectionIndex(itemKeys, null, 2, -1),
    }).toStrictEqual({
      fallbackDown: 0,
      fallbackUp: 3,
      visibleDown: 1,
      visibleUp: 2,
    });
  });

  it("moves and clamps the current scheduled row like the mailbox", () => {
    const itemKeys = ["first", "second", "third"];

    expect({
      afterSecond: getScheduledMailSelectionIndex(itemKeys, "second", 0, 1),
      beforeSecond: getScheduledMailSelectionIndex(itemKeys, "second", 2, -1),
      pastEnd: getScheduledMailSelectionIndex(itemKeys, "third", 0, 1),
      pastStart: getScheduledMailSelectionIndex(itemKeys, "first", 2, -1),
    }).toStrictEqual({
      afterSecond: 2,
      beforeSecond: 0,
      pastEnd: 2,
      pastStart: 0,
    });
  });

  it("returns focus to the Scheduled heading after clearing the active row", () => {
    const rowFocus = vi.fn<() => void>();
    const headingFocus = vi.fn<() => void>();
    const rowTargets = new Map([["active", { focus: rowFocus }]]);
    const heading = { focus: headingFocus };

    focusScheduledMailTarget("active", rowTargets, heading);
    focusScheduledMailTarget(null, rowTargets, heading);

    expect({
      headingFocusCount: headingFocus.mock.calls.length,
      rowFocusCount: rowFocus.mock.calls.length,
    }).toStrictEqual({ headingFocusCount: 1, rowFocusCount: 1 });
  });
});
