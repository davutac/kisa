import { describe, expect, it } from "vitest";

import {
  canSearchFromBar,
  CLEAR_SEARCH_VALUE,
  describeMailSearchScope,
  getMailSearchBarSections,
  getMailSearchPlaceholder,
  resolveMailSearchBarSelection,
  SHOW_ALL_RESULTS_VALUE,
} from "../src/renderer/src/components/mail/mail-search/mail-search-bar";

describe("search bar queries", () => {
  it("searches once the query asks for something", () => {
    expect(canSearchFromBar({ filters: [], text: "" })).toBeFalsy();
    expect(canSearchFromBar({ filters: [], text: "i" })).toBeFalsy();
    expect(canSearchFromBar({ filters: [], text: "from:" })).toBeFalsy();
    expect(canSearchFromBar({ filters: [], text: "in" })).toBeTruthy();
    expect(
      canSearchFromBar({
        filters: [{ field: "has", value: "attachment" }],
        text: "",
      })
    ).toBeTruthy();
  });
});

describe("search bar sections", () => {
  it("lists only filters before there is anything to search", () => {
    expect(
      getMailSearchBarSections({
        canSearch: false,
        isDraftingFilter: false,
        isShowingResults: false,
      })
    ).toStrictEqual(["completions"]);
  });

  it("leads with conversations, or with a filter being typed", () => {
    expect(
      getMailSearchBarSections({
        canSearch: true,
        isDraftingFilter: false,
        isShowingResults: false,
      })
    ).toStrictEqual(["conversations", "completions"]);
    expect(
      getMailSearchBarSections({
        canSearch: true,
        isDraftingFilter: true,
        isShowingResults: false,
      })
    ).toStrictEqual(["completions", "conversations"]);
  });

  it("offers to clear only while the mailbox shows results", () => {
    expect(
      getMailSearchBarSections({
        canSearch: false,
        isDraftingFilter: false,
        isShowingResults: true,
      })
    ).toStrictEqual(["completions", "clear"]);
  });
});

describe("search bar selection", () => {
  const rows = ["thread:a:1", "thread:b:2"];

  it("keeps the highlighted item while it is still listed", () => {
    const values = [SHOW_ALL_RESULTS_VALUE, ...rows, CLEAR_SEARCH_VALUE];

    expect(resolveMailSearchBarSelection(values, "thread:b:2")).toBe(
      "thread:b:2"
    );
    expect(resolveMailSearchBarSelection(values, "thread:gone:3")).toBe(
      SHOW_ALL_RESULTS_VALUE
    );
    expect(resolveMailSearchBarSelection([], "thread:a:1")).toBe("");
  });
});

describe("search bar scope", () => {
  it("names the scope the mailbox view adds", () => {
    expect(
      describeMailSearchScope({ mailbox: "inbox", unreadOnly: false })
    ).toBe("All mail");
    expect(describeMailSearchScope({ mailbox: "sent", unreadOnly: true })).toBe(
      "Sent · unread only"
    );
    expect(
      describeMailSearchScope({
        mailbox: { label: "Work/Clients" },
        unreadOnly: false,
      })
    ).toBe("Work/Clients");
  });

  it("names the place it searches in the placeholder", () => {
    expect(getMailSearchPlaceholder("inbox")).toBe("Search all mail");
    expect(getMailSearchPlaceholder("trash")).toBe("Search Trash");
    expect(getMailSearchPlaceholder({ label: "Work" })).toBe("Search Work");
  });
});
