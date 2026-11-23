import { describe, expect, it } from "vitest";

import {
  buildSettingsSearchIndex,
  searchSettings,
} from "../src/renderer/src/components/settings/settings-search";
import type { SettingsSearchAvailability } from "../src/renderer/src/components/settings/settings-search";

const DESKTOP: SettingsSearchAvailability = {
  accounts: [
    { displayName: "Ana Lima", email: "ana@example.com", provider: "gmail" },
    { email: "bo@example.com", provider: "outlook" },
  ],
  hasAi: true,
  hasAppSettings: true,
  hasLoginItem: true,
  hasMail: true,
  hasSettings: true,
  hasUpdates: true,
  hasWindow: true,
};

const titles = (query: string, availability = DESKTOP) =>
  searchSettings(buildSettingsSearchIndex(availability), query).map(
    ({ page, title }) => `${title} · ${page}`
  );

describe("settings search index", () => {
  it("lists only what the runtime shows, as on the web", () => {
    expect(
      buildSettingsSearchIndex({
        accounts: [],
        hasAi: false,
        hasAppSettings: false,
        hasLoginItem: false,
        hasMail: false,
        hasSettings: false,
        hasUpdates: false,
        hasWindow: false,
      }).map(({ id }) => id)
    ).toStrictEqual(["general", "general#theme", "general#animations"]);
  });

  it("keeps every page and setting apart, across accounts", () => {
    const ids = buildSettingsSearchIndex(DESKTOP).map(({ id }) => id);

    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toStrictEqual(
      []
    );
    expect(ids).toContain("account:ana@example.com#signature");
    expect(ids).toContain("account:bo@example.com#signature");
  });
});

describe("searching settings", () => {
  it("finds nothing until something is typed", () => {
    expect(titles("  ")).toStrictEqual([]);
  });

  it("ranks a title that is the query, then one that starts with it, then one that holds it", () => {
    expect(titles("labels")).toStrictEqual([
      "Labels · account:ana@example.com",
      "Labels · account:bo@example.com",
      "System labels · account:ana@example.com",
      "System labels · account:bo@example.com",
      "Automatic categorization · account:ana@example.com",
      "Automatic categorization · account:bo@example.com",
    ]);
  });

  it("matches every word against the title, the page and the keywords", () => {
    expect({
      byKeyword: titles("dark mode"),
      byPage: titles("data"),
      byProvider: titles("outlook signature"),
      byWords: titles("signature ana lima"),
    }).toStrictEqual({
      byKeyword: ["Theme · general"],
      byPage: [
        "Data · data",
        "Import database · data",
        "Recovery key · data",
        "Keep images from opened emails · data",
      ],
      byProvider: ["Email signature · account:bo@example.com"],
      byWords: ["Email signature · account:ana@example.com"],
    });
  });

  it("finds an account's page by its address", () => {
    expect(titles("bo@example.com")[0]).toBe(
      "bo@example.com · account:bo@example.com"
    );
  });
});
