import { getSchema } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { StarterKit } from "@tiptap/starter-kit";
import { findSuggestionMatch } from "@tiptap/suggestion";
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
  it("matches a slash typed at the start of an empty paragraph", () => {
    const schema = getSchema([StarterKit]);
    const state = EditorState.create({
      doc: schema.nodeFromJSON({
        content: [
          { content: [{ text: "/", type: "text" }], type: "paragraph" },
        ],
        type: "doc",
      }),
    });

    expect(
      findSuggestionMatch({
        $position: state.doc.resolve(2),
        allowSpaces: false,
        allowToIncludeChar: false,
        allowedPrefixes: [" "],
        char: "/",
        startOfLine: false,
      })
    ).toStrictEqual({ query: "", range: { from: 1, to: 2 }, text: "/" });
  });

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
