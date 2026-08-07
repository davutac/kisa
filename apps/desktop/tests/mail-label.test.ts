import { describe, expect, it } from "@effect/vitest";

import {
  formatGmailLabel,
  hasInboxLabel,
  isSystemGmailLabel,
  visibleGmailLabels,
} from "../src/renderer/src/mail/label";

describe(formatGmailLabel, () => {
  it("formats Gmail system labels in English", () => {
    expect(formatGmailLabel("CATEGORY_UPDATES")).toBe("Updates");
    expect(formatGmailLabel("INBOX")).toBe("Inbox");
    expect(formatGmailLabel("IMPORTANT")).toBe("Important");
  });

  it("preserves user-created label names", () => {
    expect(formatGmailLabel("Project Kisa")).toBe("Project Kisa");
  });
});

describe(isSystemGmailLabel, () => {
  it("recognises the labels Gmail owns", () => {
    expect(isSystemGmailLabel("INBOX")).toBeTruthy();
    expect(isSystemGmailLabel("CATEGORY_PROMOTIONS")).toBeTruthy();
    expect(isSystemGmailLabel("CATEGORY_ANYTHING_GMAIL_ADDS")).toBeTruthy();
  });

  it("leaves user-created labels alone", () => {
    expect(isSystemGmailLabel("Project Kisa")).toBeFalsy();
    expect(isSystemGmailLabel("constructor")).toBeFalsy();
  });
});

describe(visibleGmailLabels, () => {
  it("keeps every label while system labels are shown", () => {
    expect(visibleGmailLabels(["INBOX", "Project Kisa"], true)).toStrictEqual([
      "INBOX",
      "Project Kisa",
    ]);
  });

  it("keeps only user labels while system labels are hidden", () => {
    expect(
      visibleGmailLabels(["INBOX", "UNREAD", "Project Kisa"], false)
    ).toStrictEqual(["Project Kisa"]);
  });
});

describe(hasInboxLabel, () => {
  it("distinguishes Inbox threads from stale Trash entries", () => {
    expect(hasInboxLabel(["INBOX", "CATEGORY_UPDATES"])).toBeTruthy();
    expect(hasInboxLabel(["TRASH", "CATEGORY_UPDATES"])).toBeFalsy();
  });
});
