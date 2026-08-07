import { describe, expect, it } from "vitest";

import {
  addSearchFilter,
  EMPTY_SEARCH_QUERY,
  extractSearchFilters,
  formatSearchQuery,
  getSearchAccountIds,
  isSearchQueryEmpty,
  parseFilterDraft,
  parseSearchQuery,
  removeFilterDraft,
  removeSearchFilterAt,
  toIndexSearchFilters,
} from "../src/renderer/src/mail/search-query";

const ACCOUNTS = ["one@example.com", "two@example.com"];

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

  it("leaves unknown operators as text", () => {
    expect(parseSearchQuery("label:work")).toStrictEqual({
      filters: [],
      text: "label:work",
    });
  });

  it("ignores an operator with no value", () => {
    expect(parseSearchQuery("from:")).toStrictEqual({
      filters: [],
      text: "from:",
    });
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

describe(isSearchQueryEmpty, () => {
  it("treats whitespace as empty", () => {
    expect(isSearchQueryEmpty({ filters: [], text: "   " })).toBeTruthy();
    expect(
      isSearchQueryEmpty({
        filters: [{ field: "is", value: "unread" }],
        text: "",
      })
    ).toBeFalsy();
  });
});
