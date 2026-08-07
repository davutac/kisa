import { describe, expect, it } from "@effect/vitest";

import {
  createAuthGateStateResolver,
  resolveInitialAuthGateState,
} from "../src/renderer/src/startup/auth-gate";

describe(resolveInitialAuthGateState, () => {
  it("treats browser mode as authenticated after startup", async () => {
    await expect(
      resolveInitialAuthGateState({ isWeb: true })
    ).resolves.toStrictEqual({
      accounts: [],
      status: "authenticated",
    });
  });

  it("returns the initial authenticated account state", async () => {
    const account = {
      avatarUrl: "https://example.com/avatar.png",
      displayName: "Person",
      email: "person@example.com",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    };

    await expect(
      resolveInitialAuthGateState({
        auth: {
          listGoogleAccounts: () =>
            Promise.resolve({ data: [account], ok: true }),
        },
        isWeb: false,
      })
    ).resolves.toStrictEqual({ accounts: [account], status: "authenticated" });
  });

  it("returns unauthenticated when no Google accounts exist", async () => {
    await expect(
      resolveInitialAuthGateState({
        auth: {
          listGoogleAccounts: () => Promise.resolve({ data: [], ok: true }),
        },
        isWeb: false,
      })
    ).resolves.toStrictEqual({ status: "unauthenticated" });
  });

  it("surfaces startup failures through the route error boundary", async () => {
    await expect(
      resolveInitialAuthGateState({
        isWeb: false,
        startup: {
          start: () =>
            Promise.resolve({
              error: { message: "Database failed", reason: "migrate" },
              ok: false,
            }),
        },
      })
    ).rejects.toThrow("Database failed");
  });

  it("fails visibly when Electron starts without its preload bridge", async () => {
    await expect(resolveInitialAuthGateState({ isWeb: false })).rejects.toThrow(
      "preload bridge did not load"
    );
  });
});

describe(createAuthGateStateResolver, () => {
  it("reuses authenticated bootstrap state across route navigation", async () => {
    let loadCount = 0;
    const state = { accounts: [], status: "authenticated" } as const;
    const resolve = createAuthGateStateResolver(() => {
      loadCount += 1;
      return Promise.resolve(state);
    });

    await expect(resolve()).resolves.toBe(state);
    await expect(resolve()).resolves.toBe(state);
    expect(loadCount).toBe(1);
  });

  it("shares concurrent bootstrap requests", async () => {
    let loadCount = 0;
    const state = { accounts: [], status: "authenticated" } as const;
    const resolve = createAuthGateStateResolver(() => {
      loadCount += 1;
      return Promise.resolve(state);
    });

    await Promise.all([resolve(), resolve()]);
    expect(loadCount).toBe(1);
  });

  it("rechecks unauthenticated state so a completed login can be observed", async () => {
    let loadCount = 0;
    const resolve = createAuthGateStateResolver(() => {
      loadCount += 1;
      return Promise.resolve({ status: "unauthenticated" });
    });

    await resolve();
    await resolve();
    expect(loadCount).toBe(2);
  });
});
