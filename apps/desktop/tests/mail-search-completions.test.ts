import { describe, expect, it } from "vitest";

import { getMailSearchCompletions } from "../src/renderer/src/components/mail/mail-search/mail-search-completions";

const getCompletions = (
  overrides: Partial<Parameters<typeof getMailSearchCompletions>[0]> = {}
) =>
  getMailSearchCompletions({
    onSelectField: () => {},
    onSelectFilter: () => {},
    senders: [],
    typedWord: "",
    ...overrides,
  });

describe(getMailSearchCompletions, () => {
  it("keeps filter options visible for ordinary free text", () => {
    expect(
      getCompletions({ typedWord: "invoice" }).items.map(({ value }) => value)
    ).toStrictEqual(["field:from", "field:to", "field:subject", "field:has"]);
  });

  it("does not offer label as a search operator", () => {
    expect(
      getCompletions({ typedWord: "la" }).items.map(({ value }) => value)
    ).toStrictEqual(["field:from", "field:to", "field:subject", "field:has"]);
  });

  it("keeps an empty option state for an unmatched operator value", () => {
    expect(
      getCompletions({
        draft: { field: "has", value: "calendar" },
        typedWord: "has:calendar",
      })
    ).toMatchObject({
      empty: "No search options match that value.",
      heading: "Has",
      items: [],
    });
  });
});
