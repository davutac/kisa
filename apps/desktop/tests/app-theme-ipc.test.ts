// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { beforeEach, vi } from "vitest";

import type { AppTheme } from "../src/shared/ipc/app";
import { APP_SET_THEME_CHANNEL } from "../src/shared/ipc/channels";

const mocks = vi.hoisted(() => ({
  setNativeTheme: vi.fn<(theme: AppTheme) => void>(),
}));

// The module reaches for Electron's `nativeTheme`, which a Vitest worker
// does not have.
vi.mock(import("../src/main/window/native-theme"), () => ({
  setNativeTheme: mocks.setNativeTheme,
}));

const { setAppTheme } = await import("../src/main/ipc/methods/app-theme");

describe("app theme IPC", () => {
  beforeEach(() => {
    mocks.setNativeTheme.mockReset();
  });

  it.effect("hands the chosen theme to Electron", () =>
    Effect.gen(function* setAppThemeThroughIpc() {
      const reply = yield* setAppTheme.handler({ theme: "dark" });

      expect(setAppTheme.channel).toBe(APP_SET_THEME_CHANNEL);
      expect(mocks.setNativeTheme).toHaveBeenCalledWith("dark");
      expect(reply).toStrictEqual({ data: undefined, ok: true });
    })
  );

  it.effect(
    "passes the system choice on as it is, not what it resolves to",
    () =>
      Effect.gen(function* setSystemThemeThroughIpc() {
        yield* setAppTheme.handler({ theme: "system" });

        expect(mocks.setNativeTheme).toHaveBeenCalledWith("system");
      })
  );

  it.effect("refuses a theme it does not know", () =>
    Effect.gen(function* rejectsAnUnknownTheme() {
      const error = yield* Effect.flip(setAppTheme.handler({ theme: "sepia" }));

      expect(Schema.isSchemaError(error)).toBeTruthy();
      expect(mocks.setNativeTheme).not.toHaveBeenCalled();
    })
  );

  it.effect("reports a failure instead of throwing across the bridge", () =>
    Effect.gen(function* reportsAFailure() {
      mocks.setNativeTheme.mockImplementation(() => {
        throw new Error("native theme unavailable");
      });

      const reply = yield* setAppTheme.handler({ theme: "light" });

      expect(reply).toMatchObject({ ok: false });
    })
  );
});
