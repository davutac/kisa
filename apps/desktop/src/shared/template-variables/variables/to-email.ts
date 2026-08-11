import type { TemplateVariableDefinition } from "../types";

export const toEmailVariable = {
  group: "Composer",
  insertions: [
    {
      description: "Available when there is exactly one To recipient",
      emptyPreview: "Requires one To recipient",
      expression: "to.email",
      label: "To email",
    },
  ],
  name: "to.email",
  pattern: /^to\.email(?::(?<format>[^{}]*))?$/u,
  resolve: ({ context, match }) =>
    match.groups?.format === undefined
      ? { ok: true, value: context.toEmail ?? "" }
      : { message: "to.email does not support a format", ok: false },
} satisfies TemplateVariableDefinition;
