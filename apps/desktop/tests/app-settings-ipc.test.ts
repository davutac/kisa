// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import type { BrowserWindow } from "electron";
import { beforeEach, vi } from "vitest";

import type { ThreadWindowOpenRequest } from "../src/shared/ipc/app";
import {
  APP_GET_SETTINGS_CHANNEL,
  APP_UPDATE_SETTINGS_CHANNEL,
} from "../src/shared/ipc/channels";

const mocks = vi.hoisted(() => ({
  getCurrentAppSettings: vi.fn<() => { readonly runInBackground: boolean }>(
    () => ({ runInBackground: false })
  ),
  getMainWindow: vi.fn<() => BrowserWindow | undefined>(),
  setBackgroundTray:
    vi.fn<
      (enabled: boolean, getWindow: () => BrowserWindow | undefined) => void
    >(),
  writeAppSettings:
    vi.fn<(next: { readonly runInBackground: boolean }) => void>(),
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
  getAppStartupReply: vi.fn<() => Promise<{ readonly ok: true }>>(),
}));

const { getAppSettings, updateAppSettings } =
  await import("../src/main/ipc/methods/app");

describe("app settings IPC", () => {
  beforeEach(() => {
    mocks.getCurrentAppSettings.mockReturnValue({ runInBackground: false });
    mocks.writeAppSettings.mockClear();
    mocks.setBackgroundTray.mockClear();
  });

  it.effect("reads the persisted app settings", () =>
    Effect.gen(function* readAppSettingsThroughIpc() {
      const reply = yield* getAppSettings.handler(undefined);

      expect(getAppSettings.channel).toBe(APP_GET_SETTINGS_CHANNEL);
      expect(reply).toStrictEqual({
        data: { runInBackground: false },
        ok: true,
      });
    })
  );

  it.effect("persists the toggle and keeps the tray in sync", () =>
    Effect.gen(function* updateAppSettingsThroughIpc() {
      mocks.getCurrentAppSettings.mockReturnValue({ runInBackground: true });
      const request = { runInBackground: true as const };
      const reply = yield* updateAppSettings.handler(request);

      expect(updateAppSettings.channel).toBe(APP_UPDATE_SETTINGS_CHANNEL);
      expect(mocks.writeAppSettings).toHaveBeenCalledWith(request);
      expect(mocks.setBackgroundTray).toHaveBeenCalledWith(
        true,
        mocks.getMainWindow
      );
      expect(reply).toStrictEqual({
        data: { runInBackground: true },
        ok: true,
      });
    })
  );

  it("rejects a non-boolean run-in-background value", async () => {
    const exit = await Effect.runPromiseExit(
      updateAppSettings.handler({ runInBackground: "yes" })
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(mocks.writeAppSettings).not.toHaveBeenCalled();
  });
});
