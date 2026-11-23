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

const getFields = (
  overrides: Partial<Parameters<typeof getMailSearchCompletions>[0]>
) => getCompletions(overrides).items.map(({ field }) => field);

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

  it("tags each option with the filter it adds, which picks its icon", () => {
    expect({
      asTyped: getFields({
        draft: { field: "to", value: "ana" },
        typedWord: "to:ana",
      }),
      attachment: getFields({
        draft: { field: "has", value: "" },
        typedWord: "has:",
      }),
      draft: getFields({
        draft: { field: "subject", value: "invoice" },
        draftFilter: { field: "subject", value: "invoice" },
        typedWord: "subject:invoice",
      }),
      empty: getFields({}),
      sender: getFields({
        draft: { field: "from", value: "ada" },
        senders: [{ address: "ada@example.com", messageCount: 3, name: "Ada" }],
        typedWord: "from:ada",
      }),
    }).toStrictEqual({
      asTyped: ["to"],
      attachment: ["has"],
      draft: ["subject"],
      empty: ["from", "to", "subject", "has"],
      sender: ["from", "from"],
    });
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
