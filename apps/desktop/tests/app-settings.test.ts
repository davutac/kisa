import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentAppSettings,
  hydrateAppSettings,
  writeAppSettings,
} from "../src/main/settings/app-settings";

const fileState = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

// Partial adapters keep persistence tests away from live app data.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("node:fs", () => ({
  existsSync: (filePath: string) => fileState.files.has(filePath),
  mkdirSync: vi.fn<() => void>(),
  readFileSync: (filePath: string) => {
    const contents = fileState.files.get(filePath);
    if (contents === undefined) {
      throw new Error(`Missing test file: ${filePath}`);
    }
    return contents;
  },
  writeFileSync: (filePath: string, contents: string) => {
    fileState.files.set(filePath, contents);
  },
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("electron", () => ({
  app: { getPath: () => "/test/user-data" },
}));

const settingsPath = path.join("/test/user-data", "app-settings.json");

describe("app settings", () => {
  beforeEach(() => {
    fileState.files.clear();
  });

  it("defaults to running in the background", () => {
    hydrateAppSettings();

    expect(getCurrentAppSettings()).toStrictEqual({ runInBackground: true });
  });

  it("persists and reloads the run-in-background preference", () => {
    writeAppSettings({ runInBackground: true });

    expect(getCurrentAppSettings()).toStrictEqual({ runInBackground: true });
    expect(fileState.files.has(settingsPath)).toBeTruthy();

    hydrateAppSettings();
    expect(getCurrentAppSettings()).toStrictEqual({ runInBackground: true });
  });

  it("falls back to defaults for an undecodable settings file", () => {
    fileState.files.set(settingsPath, "not-json");

    hydrateAppSettings();

    expect(getCurrentAppSettings()).toStrictEqual({ runInBackground: true });
  });
});
