import { describe, expect, it } from "vitest";

import { filterTemplateSuggestions } from "../src/renderer/src/templates/template-slash-command";

const template = (id: string, name: string) => ({
  accountId: null,
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  createdAt: 1,
  id,
  name,
  subject: "",
  to: [],
  updatedAt: 1,
});

describe(filterTemplateSuggestions, () => {
  it("filters names case-insensitively and prioritizes prefix matches", () => {
    expect(
      filterTemplateSuggestions(
        [
          template("1", "Meeting follow-up"),
          template("2", "Follow-up introduction"),
          template("3", "Invoice"),
        ],
        "follow"
      ).map(({ name }) => name)
    ).toStrictEqual(["Follow-up introduction", "Meeting follow-up"]);
  });
});
