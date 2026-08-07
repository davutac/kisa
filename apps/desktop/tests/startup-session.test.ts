import { describe, expect, it } from "@effect/vitest";

import { requestStartupSession } from "../src/renderer/src/startup/startup-session";

describe(requestStartupSession, () => {
  it("treats a missing startup adapter as already started", async () => {
    await expect(requestStartupSession({})).resolves.toStrictEqual({
      state: "started",
    });
  });

  it("returns startup errors from the bridge reply", async () => {
    await expect(
      requestStartupSession({
        startupAdapter: {
          start: () =>
            Promise.resolve({
              error: { message: "Database failed", reason: "migrate" },
              ok: false,
            }),
        },
      })
    ).resolves.toStrictEqual({ message: "Database failed", state: "failed" });
  });

  it("returns aborted when the abort signal fires before the reply is handled", async () => {
    const abortController = new AbortController();
    const promise = requestStartupSession({
      abortSignal: abortController.signal,
      startupAdapter: {
        start: () => {
          abortController.abort();
          return Promise.resolve({ ok: true });
        },
      },
    });

    await expect(promise).resolves.toStrictEqual({ state: "aborted" });
  });
});
