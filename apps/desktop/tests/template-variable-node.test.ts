import { generateText } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import { describe, expect, it } from "vitest";

import {
  resolveTemplateVariableContent,
  TemplateVariable,
  templateTextToVariableDocument,
  variableDocumentToTemplateText,
} from "../src/renderer/src/templates/template-variable";

const content = {
  content: [
    {
      content: [
        { text: "Today is ", type: "text" },
        {
          attrs: { expression: "date:dd.MM.yyyy" },
          type: "templateVariable",
        },
      ],
      type: "paragraph",
    },
  ],
  type: "doc",
};

describe("template variable node", () => {
  it("round-trips as readable template text", () => {
    expect(
      generateText(content, [StarterKit, TemplateVariable], {
        blockSeparator: "\n",
      })
    ).toBe("Today is {{date:dd.MM.yyyy}}");
  });

  it("round-trips registry variables as structured inline content", () => {
    expect(
      generateText(
        {
          content: [
            {
              content: [
                {
                  attrs: { expression: "account.email" },
                  type: "templateVariable",
                },
              ],
              type: "paragraph",
            },
          ],
          type: "doc",
        },
        [StarterKit, TemplateVariable]
      )
    ).toBe("{{account.email}}");
  });

  it("converts a plain subject into variable atoms and back", () => {
    const subject = "Report for {{date:MMMM yyyy}} from {{account.email}}";
    const document = templateTextToVariableDocument(subject);

    expect(document.content?.[0]?.content).toStrictEqual([
      { text: "Report for ", type: "text" },
      {
        attrs: { expression: "date:MMMM yyyy" },
        type: "templateVariable",
      },
      { text: " from ", type: "text" },
      {
        attrs: { expression: "account.email" },
        type: "templateVariable",
      },
    ]);
    expect(variableDocumentToTemplateText(document)).toBe(subject);
  });

  it("resolves atom nodes to ordinary text without disturbing surrounding content", () => {
    expect(
      resolveTemplateVariableContent(content, {
        locale: "en-US",
        now: new Date(2026, 7, 10, 12).getTime(),
      })
    ).toStrictEqual({
      ok: true,
      value: {
        content: [
          {
            content: [
              { text: "Today is ", type: "text" },
              { text: "10.08.2026", type: "text" },
            ],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
    });
  });

  it("removes variables that resolve to an empty value", () => {
    expect(
      resolveTemplateVariableContent(
        {
          content: [
            {
              content: [
                { text: "Account: ", type: "text" },
                {
                  attrs: { expression: "account.email" },
                  type: "templateVariable",
                },
              ],
              type: "paragraph",
            },
          ],
          type: "doc",
        },
        { now: 0 }
      )
    ).toStrictEqual({
      ok: true,
      value: {
        content: [
          {
            content: [{ text: "Account: ", type: "text" }],
            type: "paragraph",
          },
        ],
        type: "doc",
      },
    });
  });

  it("rejects malformed closing braces in plain body text", () => {
    expect(
      resolveTemplateVariableContent(
        {
          content: [
            {
              content: [{ text: "Hello }}", type: "text" }],
              type: "paragraph",
            },
          ],
          type: "doc",
        },
        { now: 0 }
      )
    ).toStrictEqual({
      message: "Unexpected template variable closing braces",
      ok: false,
    });
  });
});
