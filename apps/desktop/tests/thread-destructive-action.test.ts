import { describe, expect, it } from "vitest";

import {
  getBulkThreadDestructiveAction,
  getThreadDestructiveAction,
} from "../src/renderer/src/mail/thread-destructive-action";

describe(getThreadDestructiveAction, () => {
  it("permanently deletes only Spam and Trash conversations", () => {
    expect(getThreadDestructiveAction(["INBOX"])).toBe("trash");
    expect(getThreadDestructiveAction(["SENT"])).toBe("trash");
    expect(getThreadDestructiveAction(["SPAM"])).toBe("deleteForever");
    expect(getThreadDestructiveAction(["SENT", "TRASH"])).toBe("deleteForever");
  });
});

describe(getBulkThreadDestructiveAction, () => {
  it("requires the whole selection to have the same destructive action", () => {
    expect(getBulkThreadDestructiveAction([])).toBeUndefined();
    expect(
      getBulkThreadDestructiveAction([
        { labels: ["SPAM"] },
        { labels: ["TRASH"] },
      ])
    ).toBe("deleteForever");
    expect(
      getBulkThreadDestructiveAction([
        { labels: ["INBOX"] },
        { labels: ["SENT"] },
      ])
    ).toBe("trash");
    expect(
      getBulkThreadDestructiveAction([
        { labels: ["INBOX"] },
        { labels: ["TRASH"] },
      ])
    ).toBeUndefined();
  });
});
