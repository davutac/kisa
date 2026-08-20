// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { beforeEach, vi } from "vitest";

import type { LoginItemSettings } from "../src/shared/ipc/app";
import {
  APP_GET_LOGIN_ITEM_SETTINGS_CHANNEL,
  APP_SET_LOGIN_ITEM_SETTINGS_CHANNEL,
} from "../src/shared/ipc/channels";

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => LoginItemSettings>(() => ({
    openAtLogin: false,
    requiresApproval: false,
  })),
  update: vi.fn<(openAtLogin: boolean) => LoginItemSettings>((openAtLogin) => ({
    openAtLogin,
    requiresApproval: false,
  })),
}));

vi.mock(import("../src/main/settings/login-item-settings"), () => ({
  readLoginItemSettings: mocks.read,
  updateLoginItemSettings: mocks.update,
}));

const { getLoginItemSettings, setLoginItemSettings } =
  await import("../src/main/ipc/methods/login-item-settings");

describe("login item settings IPC", () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockReturnValue({
      openAtLogin: false,
      requiresApproval: false,
    });
    mocks.update.mockClear();
  });

  it.effect("reads the current operating system value", () =>
    Effect.gen(function* readLoginItemSettingsThroughIpc() {
      const reply = yield* getLoginItemSettings.handler(undefined);

      expect(getLoginItemSettings.channel).toBe(
        APP_GET_LOGIN_ITEM_SETTINGS_CHANNEL
      );
      expect(reply).toStrictEqual({
        data: { openAtLogin: false, requiresApproval: false },
        ok: true,
      });
    })
  );

  it.effect("writes and returns the confirmed operating system value", () =>
    Effect.gen(function* updateLoginItemSettingsThroughIpc() {
      const reply = yield* setLoginItemSettings.handler({
        openAtLogin: true,
      });

      expect(setLoginItemSettings.channel).toBe(
        APP_SET_LOGIN_ITEM_SETTINGS_CHANNEL
      );
      expect(mocks.update).toHaveBeenCalledWith(true);
      expect(reply).toStrictEqual({
        data: { openAtLogin: true, requiresApproval: false },
        ok: true,
      });
    })
  );

  it("rejects a non-boolean launch-at-login value", async () => {
    const exit = await Effect.runPromiseExit(
      setLoginItemSettings.handler({ openAtLogin: "yes" })
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.effect(
    "returns a narrow error when Electron cannot read the setting",
    () =>
      Effect.gen(function* failToReadLoginItemSettings() {
        mocks.read.mockImplementationOnce(() => {
          throw new Error("private operating system detail");
        });

        const reply = yield* getLoginItemSettings.handler(undefined);

        expect(reply).toStrictEqual({
          error: "Could not read login item settings",
          ok: false,
        });
      })
  );
});
