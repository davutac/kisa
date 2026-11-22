import { describe, expect, it } from "@effect/vitest";

import {
  formatLabel,
  labelColorStyle,
  labelTextColor,
  hasInboxLabel,
  hasSentLabel,
  isSystemLabel,
  listUserLabels,
  sortLabelCatalog,
  sortLabelNames,
  filterVisibleLabels,
  withLabelState,
} from "../src/renderer/src/mail/label";

describe(labelColorStyle, () => {
  it("uses the paired foreground and background colors", () => {
    expect(
      labelColorStyle({ background: "#16a766", text: "#ffffff" })
    ).toStrictEqual({
      backgroundColor: "#16a766",
      color: "#ffffff",
    });
    expect(labelColorStyle()).toBeUndefined();
  });
});

describe(formatLabel, () => {
  it("formats system labels in English", () => {
    expect(formatLabel("INBOX")).toBe("Inbox");
    expect(formatLabel("inbox")).toBe("Inbox");
    expect(formatLabel("IMPORTANT")).toBe("Important");
  });

  it("preserves user-created label names", () => {
    expect(formatLabel("Project Kisa")).toBe("Project Kisa");
  });
});

describe(labelTextColor, () => {
  it("chooses an accepted contrasting text color", () => {
    expect(labelTextColor("#fef1d1")).toBe("#000000");
    expect(labelTextColor("#0d3472")).toBe("#ffffff");
  });
});

describe(isSystemLabel, () => {
  it("recognises system labels", () => {
    expect(isSystemLabel("INBOX")).toBeTruthy();
    expect(isSystemLabel("STARRED")).toBeTruthy();
  });

  it("leaves user-created labels alone", () => {
    expect(isSystemLabel("Project Kisa")).toBeFalsy();
    expect(isSystemLabel("constructor")).toBeFalsy();
  });
});

describe(listUserLabels, () => {
  it("keeps only user labels and sorts them by name", () => {
    expect(
      listUserLabels([
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

describe(sortLabelNames, () => {
  it("sorts system labels before user labels and each group by display name", () => {
    expect(sortLabelNames(["test2", "Test", "STARRED", "INBOX"])).toStrictEqual(
      ["INBOX", "STARRED", "Test", "test2"]
    );
  });
});

describe(sortLabelCatalog, () => {
  it("uses catalog type to keep every system label ahead of user labels", () => {
    expect(
      sortLabelCatalog([
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

describe(withLabelState, () => {
  it("optimistically adds and removes a label without duplicates", () => {
    expect(withLabelState(["INBOX"], "Receipts", true)).toStrictEqual([
      "INBOX",
      "Receipts",
    ]);
    expect(
      withLabelState(["INBOX", "Receipts"], "Receipts", true)
    ).toStrictEqual(["INBOX", "Receipts"]);
    expect(
      withLabelState(["INBOX", "Receipts"], "Receipts", false)
    ).toStrictEqual(["INBOX"]);
  });
});

describe(filterVisibleLabels, () => {
  it("keeps every label while system labels are shown", () => {
    expect(filterVisibleLabels(["INBOX", "Project Kisa"], true)).toStrictEqual([
      "INBOX",
      "Project Kisa",
    ]);
  });

  it("keeps only user labels while system labels are hidden", () => {
    expect(
      filterVisibleLabels(["INBOX", "UNREAD", "Project Kisa"], false)
    ).toStrictEqual(["Project Kisa"]);
  });

  it("is empty when a thread only has hidden system labels", () => {
    expect(filterVisibleLabels(["INBOX", "UNREAD"], false)).toStrictEqual([]);
  });
});

describe(hasInboxLabel, () => {
  it("distinguishes Inbox threads from stale Trash entries", () => {
    expect(hasInboxLabel(["INBOX", "STARRED"])).toBeTruthy();
    expect(hasInboxLabel(["TRASH", "STARRED"])).toBeFalsy();
  });
});

describe(hasSentLabel, () => {
  it("recognizes Sent membership anywhere in the thread label union", () => {
    expect(hasSentLabel(["SENT"])).toBeTruthy();
    expect(hasSentLabel(["INBOX", "SENT"])).toBeTruthy();
    expect(hasSentLabel(["INBOX"])).toBeFalsy();
  });
});
