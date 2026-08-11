import type { TemplateVariableDefinition } from "../types";

export const accountEmailVariable = {
  group: "Composer",
  insertions: [
    {
      description: "Account selected when the template is applied",
      emptyPreview: "Current account when applied",
      expression: "account.email",
      label: "Account email",
    },
  ],
  name: "account.email",
  pattern: /^account\.email(?::(?<format>[^{}]*))?$/u,
  resolve: ({ context, match }) =>
    match.groups?.format === undefined
      ? { ok: true, value: context.accountEmail ?? "" }
      : { message: "account.email does not support a format", ok: false },
} satisfies TemplateVariableDefinition;
