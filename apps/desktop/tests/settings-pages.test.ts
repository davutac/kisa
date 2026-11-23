import { describe, expect, it } from "vitest";

import {
  getSettingsPageLabel,
  listSettingsPages,
  resolveSettingsPage,
} from "../src/renderer/src/components/settings/settings-pages";

describe("settings pages", () => {
  it("lists General, then what the runtime offers, then each account", () => {
    expect(
      listSettingsPages({
        accountIds: ["ana@example.com", "bo@example.com"],
        hasAi: true,
        hasData: true,
      })
    ).toStrictEqual([
      "general",
      "ai",
      "data",
      "account:ana@example.com",
      "account:bo@example.com",
    ]);
  });

  it("keeps General where the runtime offers nothing else, as on the web", () => {
    expect(
      listSettingsPages({ accountIds: [], hasAi: false, hasData: false })
    ).toStrictEqual(["general"]);
  });

  it("gives way to General when the page is gone", () => {
    const pages = listSettingsPages({
      accountIds: ["bo@example.com"],
      hasAi: false,
      hasData: true,
    });

    expect({
      ai: resolveSettingsPage("ai", pages),
      data: resolveSettingsPage("data", pages),
      disconnected: resolveSettingsPage("account:ana@example.com", pages),
    }).toStrictEqual({
      ai: "general",
      data: "data",
      disconnected: "general",
    });
  });

  it("names an account's page by its address", () => {
    expect([
      getSettingsPageLabel("ai"),
      getSettingsPageLabel("account:ana@example.com"),
    ]).toStrictEqual(["AI writing", "ana@example.com"]);
  });
});
