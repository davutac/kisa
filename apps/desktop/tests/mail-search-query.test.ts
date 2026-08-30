import { describe, expect, it } from "vitest";

import {
  addSearchFilter,
  applyExternalMailSearchScope,
  createMailSearchQuery,
  extractSearchFilters,
  formatSearchQuery,
  isMailSearchQueryReady,
  parseFilterDraft,
  removeFilterDraft,
  removeSearchFilterAt,
  SEARCH_FILTER_FIELDS,
} from "../src/renderer/src/mail/search-query";

const EMPTY_SEARCH_QUERY = { filters: [], text: "" } as const;

describe("search filter fields", () => {
  it("leaves labels and read state to their mailbox controls", () => {
    expect(SEARCH_FILTER_FIELDS).toStrictEqual([
      "from",
      "to",
      "subject",
      "has",
    ]);
  });
});

describe(createMailSearchQuery, () => {
  it("starts without a hidden Inbox filter", () => {
    expect(createMailSearchQuery()).toStrictEqual({
      filters: [],
      text: "",
    });
  });
});

describe(isMailSearchQueryReady, () => {
  it("runs broad and filter-only searches immediately", () => {
    expect(isMailSearchQueryReady(EMPTY_SEARCH_QUERY)).toBeTruthy();
    expect(
      isMailSearchQueryReady({
        filters: [{ field: "from", value: "sender@example.com" }],
        text: "",
      })
    ).toBeTruthy();
  });

  it("waits for two free-text characters", () => {
    expect(isMailSearchQueryReady({ filters: [], text: "a" })).toBeFalsy();
    expect(isMailSearchQueryReady({ filters: [], text: "ab" })).toBeTruthy();
  });
});

describe(applyExternalMailSearchScope, () => {
  it("keeps Inbox search broad while applying labels and unread state", () => {
    expect(
      applyExternalMailSearchScope(
        { filters: [{ field: "from", value: "sender@example.com" }], text: "" },
        {
          labelNames: ["travel", "work"],
          mailbox: "inbox",
          unreadOnly: true,
        }
      )
    ).toStrictEqual({
      filters: [
        { field: "from", value: "sender@example.com" },
        { field: "label", value: "travel" },
        { field: "label", value: "work" },
        { field: "is", value: "unread" },
      ],
      text: "",
    });
  });

  it("adds Spam without exposing a visible search pill", () => {
    expect(
      applyExternalMailSearchScope(EMPTY_SEARCH_QUERY, {
        labelNames: [],
        mailbox: "spam",
        unreadOnly: false,
      })
    ).toStrictEqual({
      filters: [{ field: "label", value: "spam" }],
      text: "",
    });
  });

  it("adds Sent without exposing a visible search pill", () => {
    expect(
      applyExternalMailSearchScope(EMPTY_SEARCH_QUERY, {
        labelNames: [],
        mailbox: "sent",
        unreadOnly: false,
      })
    ).toStrictEqual({
      filters: [{ field: "label", value: "sent" }],
      text: "",
    });
  });

  it("adds Trash without exposing a visible search pill", () => {
    expect(
      applyExternalMailSearchScope(EMPTY_SEARCH_QUERY, {
        labelNames: [],
        mailbox: "trash",
        unreadOnly: false,
      })
    ).toStrictEqual({
      filters: [{ field: "label", value: "trash" }],
      text: "",
    });
  });
});

describe(formatSearchQuery, () => {
  it("formats Gmail's own syntax", () => {
    const raw = "from:test@gmail.com subject:invoice march";

    expect(
      formatSearchQuery({
        filters: [
          { field: "from", value: "test@gmail.com" },
          { field: "subject", value: "invoice" },
        ],
        text: "march",
      })
    ).toBe(raw);
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

  it("keeps a quoted operator value together", () => {
    expect(extractSearchFilters('from:"Jane Doe" ')).toStrictEqual({
      draft: "",
      filters: [{ field: "from", value: "Jane Doe" }],
    });
  });

  it("leaves externally controlled operators in free text", () => {
    expect(extractSearchFilters("label:spam ")).toStrictEqual({
      draft: "label:spam ",
      filters: [],
    });
    expect(extractSearchFilters("is:unread ")).toStrictEqual({
      draft: "is:unread ",
      filters: [],
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

  it("does not draft the externally controlled Spam scope", () => {
    expect(parseFilterDraft("label:spam")).toBeUndefined();
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
