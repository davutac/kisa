import { describe, expect, it } from "vitest";

import {
  listTemplateVariableInsertions,
  resolveTemplateText,
  templateVariableRegistry,
  validateTemplateText,
} from "../src/shared/template-variables";

const context = {
  locale: "en-US",
  now: new Date(2026, 7, 10, 14).getTime(),
};

describe("template variables", () => {
  it("keeps registry entries unique and insertion examples valid", () => {
    expect(new Set(templateVariableRegistry.map(({ name }) => name)).size).toBe(
      templateVariableRegistry.length
    );
    for (const { expression } of listTemplateVariableInsertions()) {
      expect(validateTemplateText(`{{${expression}}}`).ok).toBeTruthy();
    }
    for (const definition of templateVariableRegistry) {
      expect(
        definition.pattern.global || definition.pattern.sticky
      ).toBeFalsy();
      for (const insertion of definition.insertions ?? []) {
        expect(definition.pattern.test(insertion.expression)).toBeTruthy();
      }
    }
  });

  it("resolves default and explicitly formatted dates from one application time", () => {
    expect(
      resolveTemplateText(
        "Sent {{date}} ({{date:dd.MM.yyyy}} / {{date:yyyy-MM-dd}})",
        context
      )
    ).toStrictEqual({
      ok: true,
      value: "Sent Aug 10, 2026 (10.08.2026 / 2026-08-10)",
    });
  });

  it("supports unpadded date tokens", () => {
    expect(resolveTemplateText("{{date:d/M/yy}}", context)).toStrictEqual({
      ok: true,
      value: "10/8/26",
    });
  });

  it("resolves time and datetime with defaults or date-fns formats", () => {
    expect(
      resolveTemplateText(
        "{{time:HH:mm}} / {{datetime:yyyy-MM-dd HH:mm}}",
        context
      )
    ).toStrictEqual({
      ok: true,
      value: "14:00 / 2026-08-10 14:00",
    });
    expect(resolveTemplateText("{{time}}", context)).toStrictEqual({
      ok: true,
      value: "2:00 PM",
    });
  });

  it("resolves final account and single-recipient context", () => {
    expect(
      resolveTemplateText("From {{account.email}} to {{to.email}}", {
        ...context,
        accountEmail: "me@example.com",
        toEmail: "friend@example.com",
      })
    ).toStrictEqual({
      ok: true,
      value: "From me@example.com to friend@example.com",
    });
    expect(
      resolveTemplateText("{{account.email}}/{{to.email}}", context)
    ).toStrictEqual({ ok: true, value: "/" });
  });

  it.each([
    ["Hello {{dat}}", "Unknown template variable: dat"],
    ["Hello {{input:name}}", "Unknown template variable: input"],
    ["Hello {{date:DD.MM.YYYY}}", "Unsupported date format"],
    ["Hello {{date:}}", "Date format cannot be empty"],
    ["Hello {{date", "Unclosed template variable"],
  ])("rejects invalid template text %s", (source, message) => {
    expect(validateTemplateText(source)).toStrictEqual({
      message,
      ok: false,
    });
  });
});
