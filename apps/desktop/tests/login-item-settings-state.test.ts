import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LoginItemSettingsApi } from "../src/renderer/src/platform/desktop";
import {
  getLoginItemSettingsState,
  refreshLoginItemSettingsState,
  updateLoginItemSettingsState,
} from "../src/renderer/src/state/login-item-settings";

describe("login item settings state", () => {
  beforeEach(async () => {
    await refreshLoginItemSettingsState();
  });

  it("loads the operating system state", async () => {
    const get = vi.fn<LoginItemSettingsApi["get"]>(() =>
      Promise.resolve({
        data: { openAtLogin: true, requiresApproval: false },
        ok: true,
      })
    );

    await refreshLoginItemSettingsState({ get });

    expect(getLoginItemSettingsState()).toStrictEqual({
      openAtLogin: true,
      requiresApproval: false,
    });
  });

  it("replaces the optimistic value with the confirmed state", async () => {
    const reply =
      Promise.withResolvers<Awaited<ReturnType<LoginItemSettingsApi["set"]>>>();
    const set = vi.fn<LoginItemSettingsApi["set"]>(() => reply.promise);

    const update = updateLoginItemSettingsState({ set }, true);

    expect(getLoginItemSettingsState()).toStrictEqual({
      openAtLogin: true,
      requiresApproval: false,
    });

    reply.resolve({
      data: { openAtLogin: false, requiresApproval: true },
      ok: true,
    });
    await update;

    expect(getLoginItemSettingsState()).toStrictEqual({
      openAtLogin: false,
      requiresApproval: true,
    });
  });

  it("restores the previous value when an update fails", async () => {
    const previous = { openAtLogin: false, requiresApproval: false };
    await refreshLoginItemSettingsState({
      get: () => Promise.resolve({ data: previous, ok: true }),
    });
    const set = vi.fn<LoginItemSettingsApi["set"]>(() =>
      Promise.resolve({
        error: "Could not update login item settings",
        ok: false,
      })
    );

    await updateLoginItemSettingsState({ set }, true);

    expect(getLoginItemSettingsState()).toStrictEqual(previous);
  });
});
