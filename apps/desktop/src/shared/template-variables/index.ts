import { resolveTemplateVariableExpression } from "./registry";
import type { TemplateTextResult, TemplateVariableContext } from "./types";

export {
  listTemplateVariableInsertions,
  resolveTemplateVariableExpression,
  templateVariableRegistry,
} from "./registry";
export type {
  TemplateTextResult,
  TemplateVariableContext,
  TemplateVariableDefinition,
  TemplateVariableInsertion,
  TemplateVariableInsertionChoice,
  TemplateVariableResolveRequest,
} from "./types";

const TEMPLATE_OPEN = "{{";
const TEMPLATE_CLOSE = "}}";

const failure = (message: string): TemplateTextResult => ({
  message,
  ok: false,
});

export const resolveTemplateText = (
  source: string,
  context: TemplateVariableContext
): TemplateTextResult => {
  let value = "";
  let index = 0;

  while (index < source.length) {
    const opening = source.indexOf(TEMPLATE_OPEN, index);
    const unexpectedClose = source.indexOf(TEMPLATE_CLOSE, index);
    if (opening === -1) {
      if (unexpectedClose !== -1) {
        return failure("Unexpected template variable closing braces");
      }
      value += source.slice(index);
      break;
    }
    if (unexpectedClose !== -1 && unexpectedClose < opening) {
      return failure("Unexpected template variable closing braces");
    }

    value += source.slice(index, opening);
    const closing = source.indexOf(TEMPLATE_CLOSE, opening + 2);
    if (closing === -1) {
      return failure("Unclosed template variable");
    }

    const expression = source.slice(opening + 2, closing);
    if (expression.includes(TEMPLATE_OPEN)) {
      return failure("Nested template variables are not supported");
    }
    const resolved = resolveTemplateVariableExpression(expression, context);
    if (!resolved.ok) {
      return resolved;
    }

    value += resolved.value;
    index = closing + TEMPLATE_CLOSE.length;
  }

  return { ok: true, value };
};

export const validateTemplateText = (source: string): TemplateTextResult =>
  resolveTemplateText(source, {
    locale: "en-US",
    now: 0,
  });
