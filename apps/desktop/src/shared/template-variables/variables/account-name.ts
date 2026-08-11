import type { TemplateVariableDefinition } from "../types";

export const accountNameVariable = {
  group: "Composer",
  insertions: [
    {
      description:
        "Display name of the account selected when the template is applied",
      emptyPreview: "Current account name when applied",
      expression: "account.name",
      label: "Account name",
    },
  ],
  name: "account.name",
  pattern: /^account\.name(?::(?<format>[^{}]*))?$/u,
  resolve: ({ context, match }) =>
    match.groups?.format === undefined
      ? { ok: true, value: context.accountName ?? "" }
      : { message: "account.name does not support a format", ok: false },
} satisfies TemplateVariableDefinition;
