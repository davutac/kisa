import { describe, expect, it } from "@effect/vitest";

import { hasUnreadLabel, removeUnreadLabel } from "../src/main/mail/read-state";

describe("Gmail read state", () => {
  it("detects the unread system label", () => {
    expect(hasUnreadLabel(["INBOX", "UNREAD"])).toBeTruthy();
    expect(hasUnreadLabel(["INBOX"])).toBeFalsy();
    expect(hasUnreadLabel()).toBeFalsy();
  });

  it("removes only the unread system label", () => {
    expect(removeUnreadLabel(["IMPORTANT", "UNREAD", "INBOX"])).toStrictEqual([
      "IMPORTANT",
      "INBOX",
    ]);
  });
});
