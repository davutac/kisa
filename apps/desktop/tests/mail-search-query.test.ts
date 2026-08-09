import { describe, expect, it } from "vitest";

import {
  addSearchFilter,
  createScopedSearchQuery,
  extractSearchFilters,
  formatSearchQuery,
  getSearchAccountIds,
  isSearchQueryScopeOnly,
  parseFilterDraft,
  parseSearchQuery,
  removeFilterDraft,
  removeSearchFilterAt,
  toSearchLabelSuggestions,
  toIndexSearchFilters,
} from "../src/renderer/src/mail/search-query";

const ACCOUNTS = ["one@example.com", "two@example.com"];
const EMPTY_SEARCH_QUERY = { filters: [], text: "" } as const;

describe(parseSearchQuery, () => {
  it("splits operators away from the words to match", () => {
    expect(parseSearchQuery("from:test@gmail.com invoice march")).toStrictEqual(
      {
        filters: [{ field: "from", value: "test@gmail.com" }],
        text: "invoice march",
      }
    );
  });

  it("keeps a quoted value in one piece", () => {
    expect(parseSearchQuery('from:"Jane Doe" receipt')).toStrictEqual({
      filters: [{ field: "from", value: "Jane Doe" }],
      text: "receipt",
    });
  });

  it("parses a label operator", () => {
    expect(parseSearchQuery("label:inbox receipt")).toStrictEqual({
      filters: [{ field: "label", value: "inbox" }],
      text: "receipt",
    });
  });

  it("leaves unknown operators as text", () => {
    expect(parseSearchQuery("after:today")).toStrictEqual({
      filters: [],
      text: "after:today",
    });
  });

  it("ignores an operator with no value", () => {
    expect(parseSearchQuery("from:")).toStrictEqual({
      filters: [],
      text: "from:",
    });
  });
});

describe(createScopedSearchQuery, () => {
  it("defaults every search to Inbox", () => {
    expect(createScopedSearchQuery(null)).toStrictEqual({
      filters: [{ field: "label", value: "inbox" }],
      text: "",
    });
  });

  it("keeps the selected account alongside Inbox", () => {
    expect(createScopedSearchQuery("one@example.com")).toStrictEqual({
      filters: [
        { field: "account", value: "one@example.com" },
        { field: "label", value: "inbox" },
      ],
      text: "",
    });
  });
});

describe(toSearchLabelSuggestions, () => {
  it("merges indexed labels while preserving ownership and system status", () => {
    expect(
      toSearchLabelSuggestions([
        {
          accountId: "one@example.com",
          labels: [
            { id: "INBOX", name: "INBOX", type: "system" },
            {
              id: "CATEGORY_PERSONAL",
              name: "CATEGORY_PERSONAL",
              type: "system",
            },
            { id: "CHAT", name: "CHAT", type: "system" },
            { id: "SPAM", name: "SPAM", type: "system" },
            { id: "TRASH", name: "TRASH", type: "system" },
            { id: "Label_1", name: "Work", type: "user" },
          ],
        },
        {
          accountId: "two@example.com",
          labels: [
            { id: "INBOX", name: "inbox", type: "system" },
            { id: "Label_2", name: "Personal", type: "user" },
            { id: "Label_9", name: "work", type: "user" },
          ],
        },
      ])
    ).toStrictEqual([
      {
        accountIds: ["one@example.com", "two@example.com"],
        isSystem: true,
        name: "INBOX",
      },
      {
        accountIds: ["two@example.com"],
        isSystem: false,
        name: "Personal",
      },
      {
        accountIds: ["one@example.com"],
        isSystem: true,
        name: "CATEGORY_PERSONAL",
      },
      {
        accountIds: ["one@example.com", "two@example.com"],
        isSystem: false,
        name: "Work",
      },
    ]);
  });
});

describe(formatSearchQuery, () => {
  it("round-trips through Gmail's own syntax", () => {
    const raw = "from:test@gmail.com is:unread invoice";

    expect(formatSearchQuery(parseSearchQuery(raw))).toBe(raw);
  });

  it("re-quotes a value with spaces", () => {
    expect(
      formatSearchQuery({
        filters: [{ field: "from", value: "Jane Doe" }],
        text: "",
      })
    ).toBe('from:"Jane Doe"');
  });
});

describe(extractSearchFilters, () => {
  it("takes an operator once something follows it", () => {
    expect(extractSearchFilters("from:test@gmail.com ")).toStrictEqual({
      draft: "",
      filters: [{ field: "from", value: "test@gmail.com" }],
    });
  });

  it("leaves the operator being typed alone", () => {
    expect(extractSearchFilters("from:test@gmail.co")).toStrictEqual({
      draft: "from:test@gmail.co",
      filters: [],
    });
  });

  it("keeps the words around a taken operator", () => {
    expect(
      extractSearchFilters("invoice from:jane@example.com ma")
    ).toStrictEqual({
      draft: "invoice ma",
      filters: [{ field: "from", value: "jane@example.com" }],
    });
  });

  it("does not rewrite a draft it took nothing from", () => {
    expect(extractSearchFilters("invoice  march ")).toStrictEqual({
      draft: "invoice  march ",
      filters: [],
    });
  });
});

describe(parseFilterDraft, () => {
  it("reports the operator under the cursor", () => {
    expect(parseFilterDraft("invoice from:jan")).toStrictEqual({
      field: "from",
      value: "jan",
    });
  });

  it("reports an operator with no value yet", () => {
    expect(parseFilterDraft("from:")).toStrictEqual({
      field: "from",
      value: "",
    });
  });

  it("reports nothing once the operator is finished", () => {
    expect(parseFilterDraft("from:jane ")).toBeUndefined();
    expect(parseFilterDraft("invoice")).toBeUndefined();
  });
});

describe(removeFilterDraft, () => {
  it("drops the operator being typed and keeps the words", () => {
    expect(removeFilterDraft("invoice from:jan")).toBe("invoice ");
    expect(removeFilterDraft("from:jan")).toBe("");
  });
});

describe(addSearchFilter, () => {
  it("ignores a filter that is already there, whatever its case", () => {
    const query = addSearchFilter(EMPTY_SEARCH_QUERY, {
      field: "from",
      value: "Jane@Example.com",
    });

    expect(
      addSearchFilter(query, { field: "from", value: "jane@example.com" })
    ).toBe(query);
  });
});

describe(removeSearchFilterAt, () => {
  it("removes only the pill at that position", () => {
    const query = {
      filters: [
        { field: "from", value: "a@example.com" },
        { field: "is", value: "unread" },
      ],
      text: "",
    } as const;

    expect(removeSearchFilterAt(query, 0).filters).toStrictEqual([
      { field: "is", value: "unread" },
    ]);
  });
});

describe(getSearchAccountIds, () => {
  it("narrows to the account the pill names, whatever its case", () => {
    expect(
      getSearchAccountIds(
        { filters: [{ field: "account", value: "One@Example.com" }], text: "" },
        ACCOUNTS
      )
    ).toStrictEqual(["one@example.com"]);
  });

  it("searches every account when no pill names a connected one", () => {
    expect(getSearchAccountIds(EMPTY_SEARCH_QUERY, ACCOUNTS)).toStrictEqual(
      ACCOUNTS
    );
    expect(
      getSearchAccountIds(
        {
          filters: [{ field: "account", value: "gone@example.com" }],
          text: "",
        },
        ACCOUNTS
      )
    ).toStrictEqual(ACCOUNTS);
  });
});

describe(toIndexSearchFilters, () => {
  it("leaves the account pill out of what the index is asked", () => {
    expect(
      toIndexSearchFilters({
        filters: [
          { field: "account", value: "one@example.com" },
          { field: "is", value: "unread" },
        ],
        text: "",
      })
    ).toStrictEqual([{ field: "is", value: "unread" }]);
  });
});

describe(isSearchQueryScopeOnly, () => {
  it("does not treat the default Inbox and account pills as a search", () => {
    expect(isSearchQueryScopeOnly(createScopedSearchQuery(null))).toBeTruthy();
    expect(
      isSearchQueryScopeOnly(createScopedSearchQuery("one@example.com"))
    ).toBeTruthy();
  });

  it("recognizes another label or filter as a search", () => {
    expect(
      isSearchQueryScopeOnly({
        filters: [{ field: "label", value: "work" }],
        text: "",
      })
    ).toBeFalsy();
    expect(
      isSearchQueryScopeOnly({
        filters: [
          { field: "label", value: "inbox" },
          { field: "is", value: "unread" },
        ],
        text: "",
      })
    ).toBeFalsy();
  });
});
