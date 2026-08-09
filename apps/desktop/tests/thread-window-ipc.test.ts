// oxlint-disable typescript/no-unsafe-type-assertion
import { Effect, Exit } from "effect";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openThreadWindow as openThreadWindowMethod } from "../src/main/ipc/methods/app";

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
