// oxlint-disable typescript/no-unsafe-type-assertion
import { Effect, Exit } from "effect";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openThreadWindow as openThreadWindowMethod } from "../src/main/ipc/methods/app";
import type { AppSettings } from "../src/shared/ipc/app";

const mocks = vi.hoisted(() => ({
  openThreadWindow:
    vi.fn<
      (request: {
        readonly accountId: string;
        readonly threadId: string;
      }) => Promise<BrowserWindow>
    >(),
}));

vi.mock(import("../src/main/window/create-window"), () => ({
  openThreadWindow: mocks.openThreadWindow,
}));

// The tray and app settings modules touch Electron and the icon asset, which
// must not load inside a Vitest worker.
vi.mock(import("../src/main/window/tray"), () => ({
  setBackgroundTray: vi.fn<() => void>(),
}));

vi.mock(import("../src/main/settings/app-settings"), () => ({
  getCurrentAppSettings: (): AppSettings => ({
    animationsEnabled: true,
    openThreadsInNewWindows: false,
    runInBackground: false,
  }),
  writeAppSettings: vi.fn<() => void>(),
}));

// Importing startup reaches the database utility entry through its production
// module-path import, which must not execute inside a Vitest worker.
vi.mock(import("../src/main/app/startup"), () => ({
  getAppStartupReply: vi.fn<
    () => Promise<{
      readonly appSettings: AppSettings;
      readonly ok: true;
    }>
  >(),
}));

describe("openThreadWindow IPC", () => {
  beforeEach(() => {
    mocks.openThreadWindow.mockReset();
    mocks.openThreadWindow.mockResolvedValue({} as BrowserWindow);
  });

  it("opens a validated account and thread target", async () => {
    const request = {
      accountId: "person@example.com",
      threadId: "thread-id",
    };

    await expect(
      Effect.runPromise(openThreadWindowMethod.handler(request))
    ).resolves.toStrictEqual({ data: undefined, ok: true });
    expect(mocks.openThreadWindow).toHaveBeenCalledWith(request);
  });

  it("returns a redacted failure when window creation fails", async () => {
    mocks.openThreadWindow.mockRejectedValue(
      new Error("private renderer path failed")
    );

    await expect(
      Effect.runPromise(
        openThreadWindowMethod.handler({
          accountId: "person@example.com",
          threadId: "thread-id",
        })
      )
    ).resolves.toStrictEqual({
      error: "Could not open the conversation in a new window",
      ok: false,
    });
  });

  it("rejects an empty account or thread identifier", async () => {
    const exit = await Effect.runPromiseExit(
      openThreadWindowMethod.handler({ accountId: "", threadId: "" })
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(mocks.openThreadWindow).not.toHaveBeenCalled();
  });
});
