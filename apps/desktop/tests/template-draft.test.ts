import { describe, expect, it } from "@effect/vitest";

import {
  getVariablePreviewContext,
  templatesAreEqual,
} from "../src/renderer/src/routes/templates/-components/template-draft";
import type { ComposerTemplateInput } from "../src/shared/ipc/templates";

// oxlint-disable sort-keys -- insertion order is deliberate regression input
const emptyTemplate: ComposerTemplateInput = {
  accountId: null,
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  id: "template-1",
  name: "Empty",
  subject: "",
  to: [],
};

const accounts = [{ displayName: "Me Person", email: "me@example.com" }];

describe(templatesAreEqual, () => {
  it("compares template fields instead of object insertion order", () => {
    const sameTemplate: ComposerTemplateInput = {
      to: [],
      subject: "",
      name: "Empty",
      id: "template-1",
      cc: [],
      body: { text: "", html: "" },
      bcc: [],
      accountId: null,
    };

    expect(templatesAreEqual(emptyTemplate, sameTemplate)).toBeTruthy();
  });

  it("still detects a real formatting change with the same text", () => {
    const plain = {
      ...emptyTemplate,
      body: { html: "<p>Hello</p>", text: "Hello" },
    };

    expect(
      templatesAreEqual(plain, {
        ...plain,
        body: { html: "<p><strong>Hello</strong></p>", text: "Hello" },
      })
    ).toBeFalsy();
  });

  it("detects recipient ordering changes", () => {
    const addressed = {
      ...emptyTemplate,
      to: ["a@example.com", "b@example.com"],
    };

    expect(
      templatesAreEqual(addressed, {
        ...addressed,
        to: ["b@example.com", "a@example.com"],
      })
    ).toBeFalsy();
  });
});

describe(getVariablePreviewContext, () => {
  it("includes the selected account display name", () => {
    expect(
      getVariablePreviewContext(
        { ...emptyTemplate, accountId: "me@example.com" },
        accounts
      )
    ).toStrictEqual({
      accountEmail: "me@example.com",
      accountName: "Me Person",
    });
  });

  it("defers account values when the template keeps the current account", () => {
    expect(getVariablePreviewContext(emptyTemplate, accounts)).toStrictEqual(
      {}
    );
  });

  it("keeps the selected account email without cached profile metadata", () => {
    expect(
      getVariablePreviewContext(
        { ...emptyTemplate, accountId: "me@example.com" },
        []
      )
    ).toStrictEqual({ accountEmail: "me@example.com" });
  });
});
