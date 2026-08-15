import { describe, expect, it } from "@effect/vitest";

import {
  formatGmailLabel,
  gmailLabelColorStyle,
  gmailLabelTextColor,
  hasInboxLabel,
  isSystemGmailLabel,
  listUserGmailLabels,
  sortGmailLabelCatalog,
  sortGmailLabelNames,
  visibleGmailLabels,
  withGmailLabelState,
} from "../src/renderer/src/mail/label";

describe(gmailLabelColorStyle, () => {
  it("uses Gmail's paired foreground and background colors", () => {
    expect(
      gmailLabelColorStyle({ background: "#16a766", text: "#ffffff" })
    ).toStrictEqual({
      backgroundColor: "#16a766",
      color: "#ffffff",
    });
    expect(gmailLabelColorStyle()).toBeUndefined();
  });
});

describe(formatGmailLabel, () => {
  it("formats Gmail system labels in English", () => {
    expect(formatGmailLabel("CATEGORY_UPDATES")).toBe("Updates");
    expect(formatGmailLabel("INBOX")).toBe("Inbox");
    expect(formatGmailLabel("inbox")).toBe("Inbox");
    expect(formatGmailLabel("IMPORTANT")).toBe("Important");
  });

  it("preserves user-created label names", () => {
    expect(formatGmailLabel("Project Kisa")).toBe("Project Kisa");
  });
});

describe(gmailLabelTextColor, () => {
  it("chooses an accepted contrasting text color", () => {
    expect(gmailLabelTextColor("#fef1d1")).toBe("#000000");
    expect(gmailLabelTextColor("#0d3472")).toBe("#ffffff");
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

describe(listUserGmailLabels, () => {
  it("keeps only user labels and sorts them by name", () => {
    expect(
      listUserGmailLabels([
        { id: "Label_2", name: "Travel", type: "user" },
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_1", name: "Receipts", type: "user" },
        { id: "Label_3", name: "Unknown type" },
      ])
    ).toStrictEqual([
      { id: "Label_1", name: "Receipts", type: "user" },
      { id: "Label_2", name: "Travel", type: "user" },
    ]);
  });
});

describe(sortGmailLabelNames, () => {
  it("sorts system labels before user labels and each group by display name", () => {
    expect(
      sortGmailLabelNames(["test2", "Test", "CATEGORY_UPDATES", "INBOX"])
    ).toStrictEqual(["INBOX", "CATEGORY_UPDATES", "Test", "test2"]);
  });
});

describe(sortGmailLabelCatalog, () => {
  it("uses catalog type to keep every system label ahead of user labels", () => {
    expect(
      sortGmailLabelCatalog([
        { id: "Label_2", name: "Zulu", type: "user" },
        { id: "SYSTEM_CUSTOM", name: "Alpha", type: "system" },
        { id: "Label_1", name: "Alpha", type: "user" },
      ])
    ).toStrictEqual([
      { id: "SYSTEM_CUSTOM", name: "Alpha", type: "system" },
      { id: "Label_1", name: "Alpha", type: "user" },
      { id: "Label_2", name: "Zulu", type: "user" },
    ]);
  });
});

describe(withGmailLabelState, () => {
  it("optimistically adds and removes a label without duplicates", () => {
    expect(withGmailLabelState(["INBOX"], "Receipts", true)).toStrictEqual([
      "INBOX",
      "Receipts",
    ]);
    expect(
      withGmailLabelState(["INBOX", "Receipts"], "Receipts", true)
    ).toStrictEqual(["INBOX", "Receipts"]);
    expect(
      withGmailLabelState(["INBOX", "Receipts"], "Receipts", false)
    ).toStrictEqual(["INBOX"]);
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

  it("is empty when a thread only has hidden system labels", () => {
    expect(visibleGmailLabels(["INBOX", "UNREAD"], false)).toStrictEqual([]);
  });
});

describe(hasInboxLabel, () => {
  it("distinguishes Inbox threads from stale Trash entries", () => {
    expect(hasInboxLabel(["INBOX", "CATEGORY_UPDATES"])).toBeTruthy();
    expect(hasInboxLabel(["TRASH", "CATEGORY_UPDATES"])).toBeFalsy();
  });
});
