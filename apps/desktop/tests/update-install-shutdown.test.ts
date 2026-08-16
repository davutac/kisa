import { afterAll, describe, expect, it, vi } from "vitest";

import { isQuitInProgress } from "../src/main/app/quit-state";
import type { sendRendererEvent } from "../src/main/electron/renderer-events";
import {
  initializeAutoUpdates,
  installUpdate,
} from "../src/main/updates/updater";

type UpdaterEventPayload =
  | Error
  | { percent: number }
  | { version: string }
  | undefined;

const updaterState = vi.hoisted(() => {
  const listeners = new Map<string, (value?: UpdaterEventPayload) => void>();
  vi.stubEnv("APPIMAGE", "/test/Kisa.AppImage");

  return {
    autoUpdater: {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      checkForUpdates: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      downloadUpdate: vi.fn<() => Promise<void>>(() => Promise.resolve()),
      on: vi.fn<
        (event: string, listener: (value?: UpdaterEventPayload) => void) => void
      >((event, listener) => {
        listeners.set(event, listener);
      }),
      quitAndInstall: vi.fn<() => void>(),
    },
    listeners,
  };
});

vi.mock(import("electron-updater"), () => ({
  default: updaterState as never,
}));
vi.mock(import("@electron-toolkit/utils"), () => ({ is: { dev: false } }));
vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: vi.fn<typeof sendRendererEvent>(),
}));

describe("update install shutdown", () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("enters real quit state before the updater starts closing windows", () => {
    initializeAutoUpdates({ once: vi.fn<() => void>() } as never);
    updaterState.listeners.get("update-downloaded")?.({ version: "1.2.3" });

    updaterState.autoUpdater.quitAndInstall.mockImplementation(() => {
      expect(isQuitInProgress()).toBeTruthy();
    });

    installUpdate();

    expect(updaterState.autoUpdater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
