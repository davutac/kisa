import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsApi } from "../src/renderer/src/platform/desktop";
import {
  getAppSettingsState,
  hydrateAppSettingsState,
  updateAppSettingsState,
} from "../src/renderer/src/state/app-settings";
import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";

describe("app settings state", () => {
  beforeEach(() => {
    hydrateAppSettingsState(DEFAULT_APP_SETTINGS);
  });

  it("updates renderer-only settings without a desktop bridge", async () => {
    await updateAppSettingsState(undefined, { animationsEnabled: false });

    expect(getAppSettingsState().animationsEnabled).toBeFalsy();
  });

  it("rolls back the latest optimistic update when persistence fails", async () => {
    const set = vi.fn<AppSettingsApi["set"]>(() =>
      Promise.resolve({
        error: "Could not save app settings",
        ok: false as const,
      })
    );

    await updateAppSettingsState({ set }, { runInBackground: false });

    expect(set).toHaveBeenCalledWith({
      ...DEFAULT_APP_SETTINGS,
      runInBackground: false,
    });
    expect(getAppSettingsState()).toStrictEqual(DEFAULT_APP_SETTINGS);
  });

  it("ignores an older reply after a newer update", async () => {
    const first =
      Promise.withResolvers<Awaited<ReturnType<AppSettingsApi["set"]>>>();
    const second =
      Promise.withResolvers<Awaited<ReturnType<AppSettingsApi["set"]>>>();
    const set = vi
      .fn<AppSettingsApi["set"]>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const firstUpdate = updateAppSettingsState(
      { set },
      { animationsEnabled: false }
    );
    const secondUpdate = updateAppSettingsState(
      { set },
      { runInBackground: false }
    );

    second.resolve({
      data: {
        ...DEFAULT_APP_SETTINGS,
        animationsEnabled: false,
        runInBackground: false,
      },
      ok: true,
    });
    await secondUpdate;
    first.resolve({
      data: { ...DEFAULT_APP_SETTINGS, animationsEnabled: false },
      ok: true,
    });
    await firstUpdate;

    expect(getAppSettingsState()).toStrictEqual({
      ...DEFAULT_APP_SETTINGS,
      animationsEnabled: false,
      runInBackground: false,
    });
  });
});
