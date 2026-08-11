import type { JSONContent } from "@tiptap/core";
import { Node, nodeInputRule, nodePasteRule } from "@tiptap/core";

import type {
  TemplateTextResult,
  TemplateVariableContext,
} from "@/shared/template-variables";
import { resolveTemplateText } from "@/shared/template-variables";

const TEMPLATE_VARIABLE_INPUT = /\{\{[^{}]+\}\}$/u;
const TEMPLATE_VARIABLE_PASTE = /\{\{[^{}]+\}\}/gu;
const TEMPLATE_VARIABLE_TOKEN = /\{\{(?<expression>[^{}]+)\}\}/gu;

interface TemplateVariableOptions {
  readonly enableRules: boolean;
}

export type TemplateContentResult =
  | { readonly ok: true; readonly value: JSONContent | null }
  | { readonly message: string; readonly ok: false };

const toTemplateVariableToken = (expression: string): string =>
  `{{${expression}}}`;

const attributesFromToken = (token: string) => ({
  expression: token.slice(2, -2),
});

const expressionFromAttributes = (attributes: JSONContent["attrs"]): string =>
  typeof attributes?.expression === "string" ? attributes.expression : "date";

export const templateTextToVariableDocument = (source: string): JSONContent => {
  const content: JSONContent[] = [];
  let index = 0;

  for (const match of source.matchAll(TEMPLATE_VARIABLE_TOKEN)) {
    const offset = match.index;
    if (offset > index) {
      content.push({ text: source.slice(index, offset), type: "text" });
    }
    content.push({
      attrs: { expression: match.groups?.expression ?? "" },
      type: "templateVariable",
    });
    index = offset + match[0].length;
  }

  if (index < source.length) {
    content.push({ text: source.slice(index), type: "text" });
  }

  return {
    content: [
      {
        ...(content.length === 0 ? {} : { content }),
        type: "paragraph",
      },
    ],
    type: "doc",
  };
};

export const variableDocumentToTemplateText = (
  content: JSONContent
): string => {
  if (content.type === "templateVariable") {
    return toTemplateVariableToken(expressionFromAttributes(content.attrs));
  }
  if (content.type === "text") {
    return content.text ?? "";
  }
  return (content.content ?? []).map(variableDocumentToTemplateText).join("");
};

export const TemplateVariable = Node.create<TemplateVariableOptions>({
  addAttributes() {
    return {
      expression: {
        default: "date",
        parseHTML: (element) => element.dataset.templateVariable ?? "date",
      },
    };
  },
  addInputRules() {
    return this.options.enableRules
      ? [
          nodeInputRule({
            find: TEMPLATE_VARIABLE_INPUT,
            getAttributes: (match) => attributesFromToken(match[0]),
            type: this.type,
          }),
        ]
      : [];
  },
  addOptions() {
    return { enableRules: true };
  },
  addPasteRules() {
    return this.options.enableRules
      ? [
          nodePasteRule({
            find: TEMPLATE_VARIABLE_PASTE,
            getAttributes: (match) => attributesFromToken(match[0]),
            type: this.type,
          }),
        ]
      : [];
  },
  atom: true,
  group: "inline",
  inline: true,
  name: "templateVariable",
  parseHTML() {
    return [{ tag: "span[data-template-variable]" }];
  },
  renderHTML({ node }) {
    const expression = expressionFromAttributes(node.attrs);
    return [
      "span",
      {
        class: "template-variable",
        "data-template-variable": expression,
      },
      toTemplateVariableToken(expression),
    ];
  },
  renderText({ node }) {
    return toTemplateVariableToken(expressionFromAttributes(node.attrs));
  },
  selectable: false,
});

export const TemplateVariableDisplay = TemplateVariable.configure({
  enableRules: false,
});

export const resolveTemplateVariableContent = (
  content: JSONContent,
  context: TemplateVariableContext
): TemplateContentResult => {
  if (content.type === "templateVariable") {
    const token = toTemplateVariableToken(
      expressionFromAttributes(content.attrs)
    );
    const resolved: TemplateTextResult = resolveTemplateText(token, context);
    return resolved.ok
      ? {
          ok: true,
          value:
            resolved.value.length === 0
              ? null
              : {
                  ...(content.marks === undefined
                    ? {}
                    : { marks: content.marks }),
                  text: resolved.value,
                  type: "text",
                },
        }
      : resolved;
  }

  if (
    content.type === "text" &&
    (content.text?.includes("{{") === true ||
      content.text?.includes("}}") === true)
  ) {
    const resolved = resolveTemplateText(content.text, context);
    return resolved.ok
      ? {
          ok: true,
          value:
            resolved.value.length === 0
              ? null
              : { ...content, text: resolved.value },
        }
      : resolved;
  }

  if (content.content === undefined) {
    return { ok: true, value: content };
  }

  const resolvedChildren: JSONContent[] = [];
  for (const child of content.content) {
    const resolved = resolveTemplateVariableContent(child, context);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.value !== null) {
      resolvedChildren.push(resolved.value);
    }
  }

  return { ok: true, value: { ...content, content: resolvedChildren } };
};
