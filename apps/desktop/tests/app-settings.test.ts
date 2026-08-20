import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  flushAppSettings,
  getCurrentAppSettings,
  hydrateAppSettings,
  writeAppSettings,
} from "../src/main/settings/app-settings";
import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";

const fileState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  mkdir: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  rename: vi.fn<(from: string, to: string) => Promise<void>>((from, to) => {
    const contents = fileState.files.get(from);
    if (contents === undefined) {
      return Promise.reject(new Error("Missing source file"));
    }
    fileState.files.set(to, contents);
    fileState.files.delete(from);
    return Promise.resolve();
  }),
  rm: vi.fn<(filePath: string) => Promise<void>>((filePath) => {
    fileState.files.delete(filePath);
    return Promise.resolve();
  }),
  writeFile: vi.fn<(filePath: string, contents: string) => Promise<void>>(
    (filePath, contents) => {
      fileState.files.set(filePath, contents);
      return Promise.resolve();
    }
  ),
}));

// Partial adapters keep persistence tests away from live app data.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("node:fs", () => ({
  readFileSync: (filePath: string) => {
    const contents = fileState.files.get(filePath);
    if (contents === undefined) {
      throw new Error(`Missing test file: ${filePath}`);
    }
    return contents;
  },
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("node:fs/promises", () => ({
  mkdir: fileState.mkdir,
  rename: fileState.rename,
  rm: fileState.rm,
  writeFile: fileState.writeFile,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("electron", () => ({
  app: { getPath: () => "/test/user-data" },
}));

const settingsPath = path.join("/test/user-data", "app-settings.json");

describe("app settings", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fileState.files.clear();
    fileState.mkdir.mockClear();
    fileState.rename.mockClear();
    fileState.rm.mockClear();
    fileState.writeFile.mockClear();
  });

  afterEach(async () => {
    await vi.runOnlyPendingTimersAsync();
    await flushAppSettings();
    vi.useRealTimers();
  });

  it("uses defaults when the settings file is missing", () => {
    hydrateAppSettings();

    expect(getCurrentAppSettings()).toStrictEqual(DEFAULT_APP_SETTINGS);
  });

  it("persists and reloads all app settings", async () => {
    const settings = {
      animationsEnabled: false,
      launchAtLogin: true,
      openThreadsInNewWindows: true,
      runInBackground: false,
    };
    writeAppSettings(settings);

    expect(getCurrentAppSettings()).toStrictEqual(settings);
    expect(fileState.files.has(settingsPath)).toBeFalsy();

    await vi.runAllTimersAsync();
    expect(fileState.files.has(settingsPath)).toBeTruthy();
    expect(fileState.files.get(settingsPath)).toContain(
      '"runInBackground": false'
    );

    hydrateAppSettings();
    expect(getCurrentAppSettings()).toStrictEqual(settings);
  });

  it("coalesces rapid settings updates into one file write", async () => {
    writeAppSettings({ ...DEFAULT_APP_SETTINGS, animationsEnabled: false });
    writeAppSettings({ ...DEFAULT_APP_SETTINGS, runInBackground: false });
    writeAppSettings({
      ...DEFAULT_APP_SETTINGS,
      launchAtLogin: true,
      openThreadsInNewWindows: true,
      runInBackground: false,
    });

    expect(fileState.writeFile).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(fileState.writeFile).toHaveBeenCalledOnce();
    expect(fileState.rename).toHaveBeenCalledOnce();
    expect(fileState.files.get(settingsPath)).toContain(
      '"runInBackground": false'
    );
  });

  it("flushes a pending write during shutdown", async () => {
    writeAppSettings({
      ...DEFAULT_APP_SETTINGS,
      launchAtLogin: true,
      runInBackground: false,
    });

    await flushAppSettings();

    expect(fileState.writeFile).toHaveBeenCalledOnce();
    expect(fileState.files.get(settingsPath)).toContain(
      '"runInBackground": false'
    );

    await vi.runAllTimersAsync();
    expect(fileState.writeFile).toHaveBeenCalledOnce();
  });

  it("falls back to defaults for an undecodable settings file", () => {
    fileState.files.set(settingsPath, "not-json");

    hydrateAppSettings();

    expect(getCurrentAppSettings()).toStrictEqual(DEFAULT_APP_SETTINGS);
  });

  it("uses defaults when reading an older incomplete settings file", () => {
    fileState.files.set(settingsPath, '{"runInBackground":false}');

    hydrateAppSettings();

    expect(getCurrentAppSettings()).toStrictEqual(DEFAULT_APP_SETTINGS);
  });
});
