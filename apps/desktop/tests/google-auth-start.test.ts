/// <reference types="electron-vite/node" />

import { Effect } from "effect";
import type * as Electron from "electron";
import { describe, expect, it, vi } from "vitest";

import type { notifyGoogleAccountConnected } from "../src/main/auth/account-events";
import {
  handleGoogleAuthCallback,
  startGoogleAuth,
} from "../src/main/auth/auth";
import type { getDatabaseClient } from "../src/main/database";
import type { sendRendererEvent } from "../src/main/electron/renderer-events";

const electronState = vi.hoisted(() => ({
  openedUrls: [] as string[],
}));

vi.mock(import("electron"), () => ({
  BrowserWindow: {
    getAllWindows: vi.fn<typeof Electron.BrowserWindow.getAllWindows>(() => []),
  } as unknown as typeof Electron.BrowserWindow,
  app: {
    focus: vi.fn<typeof Electron.app.focus>(),
    isPackaged: true,
  } as unknown as typeof Electron.app,
  safeStorage: {
    isEncryptionAvailable: vi.fn<
      typeof Electron.safeStorage.isEncryptionAvailable
    >(() => true),
  } as unknown as typeof Electron.safeStorage,
  shell: {
    openExternal: vi.fn<typeof Electron.shell.openExternal>((url) => {
      electronState.openedUrls.push(url);
      return Promise.resolve();
    }),
  } as unknown as typeof Electron.shell,
}));

vi.mock(import("../src/main/database"), () => ({
  getDatabaseClient: vi.fn<typeof getDatabaseClient>(),
}));

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: vi.fn<typeof sendRendererEvent>(),
}));

vi.mock(import("../src/main/auth/account-events"), () => ({
  notifyGoogleAccountConnected: vi.fn<typeof notifyGoogleAccountConnected>(),
}));

describe("Google authentication startup", () => {
  it("opens a new browser flow while an earlier login is still pending", async () => {
    await Effect.runPromise(startGoogleAuth());
    await Effect.runPromise(startGoogleAuth());

    expect(electronState.openedUrls).toHaveLength(2);
  });

  it("expires a pending login after ten minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-08T12:00:00Z"));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    try {
      await Effect.runPromise(startGoogleAuth());
      const openedUrl = new URL(electronState.openedUrls.at(-1) ?? "");
      const attempt = openedUrl.searchParams.get("code_challenge");

      if (attempt === null) {
        throw new Error("Expected the login URL to contain a PKCE challenge");
      }

      vi.advanceTimersByTime(10 * 60 * 1000);
      await handleGoogleAuthCallback({ attempt, code: "authorization-code" });

      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
