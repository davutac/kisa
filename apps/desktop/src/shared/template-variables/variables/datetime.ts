import { format as formatDateWithPattern } from "date-fns";

import type { TemplateVariableDefinition } from "../types";

const MAX_FORMAT_LENGTH = 64;

const resolveDateTime: TemplateVariableDefinition["resolve"] = ({
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
        timeStyle: "short",
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

export const datetimeVariable = {
  group: "Date and time",
  insertions: [
    {
      description: "Localized date and time",
      expression: "datetime",
      label: "Date and time",
    },
    {
      description: "Example; type any valid date-fns format",
      expression: "datetime:yyyy-MM-dd HH:mm",
      label: "Date and time with format",
    },
  ],
  name: "datetime",
  pattern: /^datetime(?::(?<format>[^{}]*))?$/u,
  resolve: resolveDateTime,
} satisfies TemplateVariableDefinition;
