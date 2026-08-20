// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import type { BrowserWindow } from "electron";
import { beforeEach, vi } from "vitest";

import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";
import type {
  AppSettings,
  ThreadWindowOpenRequest,
} from "../src/shared/ipc/app";
import { APP_UPDATE_SETTINGS_CHANNEL } from "../src/shared/ipc/channels";

const mocks = vi.hoisted(() => ({
  getCurrentAppSettings: vi.fn<() => AppSettings>(() => ({
    animationsEnabled: true,
    launchAtLogin: false,
    openThreadsInNewWindows: false,
    runInBackground: true,
  })),
  getMainWindow: vi.fn<() => BrowserWindow | undefined>(),
  setBackgroundTray:
    vi.fn<
      (enabled: boolean, getWindow: () => BrowserWindow | undefined) => void
    >(),
  writeAppSettings: vi.fn<(next: AppSettings) => void>(),
}));

// The tray, window, startup, and settings modules touch Electron or the icon
// asset, which must not load inside a Vitest worker.
vi.mock(import("../src/main/settings/app-settings"), () => ({
  getCurrentAppSettings: mocks.getCurrentAppSettings,
  writeAppSettings: mocks.writeAppSettings,
}));

vi.mock(import("../src/main/window/tray"), () => ({
  setBackgroundTray: mocks.setBackgroundTray,
}));

vi.mock(import("../src/main/window/create-window"), () => ({
  getMainWindow: mocks.getMainWindow,
  openThreadWindow:
    vi.fn<(request: ThreadWindowOpenRequest) => Promise<BrowserWindow>>(),
}));

vi.mock(import("../src/main/app/startup"), () => ({
  getAppStartupReply: vi.fn<
    () => Promise<{
      readonly appSettings: AppSettings;
      readonly ok: true;
    }>
  >(),
}));

const { updateAppSettings } = await import("../src/main/ipc/methods/app");

describe("app settings IPC", () => {
  beforeEach(() => {
    mocks.getCurrentAppSettings.mockReturnValue({
      ...DEFAULT_APP_SETTINGS,
      runInBackground: false,
    });
    mocks.writeAppSettings.mockClear();
    mocks.setBackgroundTray.mockClear();
  });

  it.effect("persists the toggle and keeps the tray in sync", () =>
    Effect.gen(function* updateAppSettingsThroughIpc() {
      mocks.getCurrentAppSettings.mockReturnValue(DEFAULT_APP_SETTINGS);
      const request = DEFAULT_APP_SETTINGS;
      const reply = yield* updateAppSettings.handler(request);

      expect(updateAppSettings.channel).toBe(APP_UPDATE_SETTINGS_CHANNEL);
      expect(mocks.writeAppSettings).toHaveBeenCalledWith(request);
      expect(mocks.setBackgroundTray).toHaveBeenCalledWith(
        true,
        mocks.getMainWindow
      );
      expect(reply).toStrictEqual({
        data: DEFAULT_APP_SETTINGS,
        ok: true,
      });
    })
  );

  it("rejects a non-boolean run-in-background value", async () => {
    const exit = await Effect.runPromiseExit(
      updateAppSettings.handler({
        ...DEFAULT_APP_SETTINGS,
        runInBackground: "yes",
      })
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(mocks.writeAppSettings).not.toHaveBeenCalled();
  });
});
