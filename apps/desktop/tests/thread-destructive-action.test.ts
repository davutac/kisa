import { describe, expect, it } from "vitest";

import {
  getBulkThreadDestructiveAction,
  getThreadDestructiveAction,
} from "../src/renderer/src/mail/thread-destructive-action";

describe(getThreadDestructiveAction, () => {
  it("permanently deletes only Spam and Trash conversations", () => {
    expect(getThreadDestructiveAction(["inbox"])).toBe("trash");
    expect(getThreadDestructiveAction(["sent"])).toBe("trash");
    expect(getThreadDestructiveAction(["spam"])).toBe("deleteForever");
    expect(getThreadDestructiveAction(["trash"])).toBe("deleteForever");
  });

  it("moves mail in a folder that is only called Trash to Trash", () => {
    expect(getThreadDestructiveAction(["inbox", "label:trash"])).toBe("trash");
  });
});

describe(getBulkThreadDestructiveAction, () => {
  it("requires the whole selection to have the same destructive action", () => {
    expect(getBulkThreadDestructiveAction([])).toBeUndefined();
    expect(
      getBulkThreadDestructiveAction([
        { places: ["spam"] },
        { places: ["trash"] },
      ])
    ).toBe("deleteForever");
    expect(
      getBulkThreadDestructiveAction([
        { places: ["inbox"] },
        { places: ["sent"] },
      ])
    ).toBe("trash");
    expect(
      getBulkThreadDestructiveAction([
        { places: ["inbox"] },
        { places: ["trash"] },
      ])
    ).toBeUndefined();
  });
});
