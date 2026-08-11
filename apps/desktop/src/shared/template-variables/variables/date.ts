import { format as formatDateWithPattern } from "date-fns";

import type { TemplateVariableDefinition } from "../types";

const MAX_FORMAT_LENGTH = 64;

const resolveDate: TemplateVariableDefinition["resolve"] = ({
  context,
  match,
}) => {
  const date = new Date(context.now);
  const pattern = match.groups?.format;
  if (pattern === undefined) {
    return {
      ok: true,
      value: new Intl.DateTimeFormat(context.locale, {
        dateStyle: "medium",
      }).format(date),
    };
  }
  if (pattern.length === 0) {
    return { message: "Date format cannot be empty", ok: false };
  }
  if (pattern.length > MAX_FORMAT_LENGTH) {
    return { message: "Date format is too long", ok: false };
  }

  try {
    return { ok: true, value: formatDateWithPattern(date, pattern) };
  } catch {
    return { message: "Unsupported date format", ok: false };
  }
};

export const dateVariable = {
  group: "Date and time",
  insertions: [
    {
      description: "Localized date",
      expression: "date",
      label: "Date",
    },
    {
      description: "Example; type any valid date-fns format",
      expression: "date:dd.MM.yyyy",
      label: "Date with format",
    },
  ],
  name: "date",
  pattern: /^date(?::(?<format>[^{}]*))?$/u,
  resolve: resolveDate,
} satisfies TemplateVariableDefinition;
