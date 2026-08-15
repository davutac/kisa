/// <reference types="electron-vite/node" />

import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openThreadWindow } from "../src/main/window/create-window";
import {
  readWindowState,
  writeWindowState,
} from "../src/main/window/window-state";

interface TestWindow {
  readonly destroy: () => void;
  readonly emit: (event: string) => void;
  readonly focus: ReturnType<typeof vi.fn>;
  readonly isDestroyed: () => boolean;
  readonly loadFile: ReturnType<typeof vi.fn>;
  readonly options: Electron.BrowserWindowConstructorOptions;
}

const electronState = vi.hoisted(() => ({
  createdWindows: [] as TestWindow[],
  loadBarrier: undefined as Promise<unknown> | undefined,
  loadFailure: undefined as Error | undefined,
}));

vi.mock(import("electron"), async (importOriginal) => {
  const original = await importOriginal();
  class BrowserWindow {
    readonly focus = vi.fn<() => void>();
    readonly isMinimized = vi.fn<() => boolean>(() => false);
    readonly loadFile = vi.fn<() => Promise<void>>(async () => {
      await electronState.loadBarrier;

      if (electronState.loadFailure !== undefined) {
        throw electronState.loadFailure;
      }
    });
    readonly loadURL = vi.fn<() => Promise<void>>(async () => {});
    readonly options: Electron.BrowserWindowConstructorOptions;
    readonly restore = vi.fn<() => void>();
    readonly show = vi.fn<() => void>();
    readonly webContents = {
      getURL: vi.fn<() => string>(() => "file:///index.html"),
      on: vi.fn<(...args: unknown[]) => void>(),
      setWindowOpenHandler: vi.fn<(...args: unknown[]) => void>(),
    };
    private destroyed = false;
    private readonly handlers = new Map<string, (() => void)[]>();

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      this.options = options;
      electronState.createdWindows.push(this);
    }

    destroy(): void {
      this.destroyed = true;

      for (const handler of this.handlers.get("closed") ?? []) {
        handler();
      }
    }

    emit(event: string): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler();
      }
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    on(event: string, handler: () => void): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }
  }

  return {
    ...original,
    BrowserWindow: Object.assign(BrowserWindow, original.BrowserWindow),
  };
});

vi.mock(import("@electron-toolkit/utils"), () => ({ is: { dev: false } }));
vi.mock(import("../src/main/app/native-mail-index-progress"), () => ({
  applyNativeMailIndexProgress:
    vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/electron/shell"), () => ({
  openExternalUrl: vi.fn<(rawUrl: string) => boolean>(() => true),
}));
vi.mock(import("../src/main/updates/updater"), () => ({
  initializeAutoUpdates: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/window/native-context-menu"), () => ({
  installNativeContextMenu: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/window/window-visibility"), () => ({
  hideWindowInBackground: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/window/window-state"), () => ({
  MIN_WINDOW_SIZE: { height: 560, width: 860 } as const,
  readWindowState: vi.fn<(type?: string) => { height: number; width: number }>(
    (type = "main") =>
      type === "thread"
        ? { height: 720, width: 760 }
        : { height: 670, width: 900 }
  ),
  writeWindowState:
    vi.fn<(window: Electron.BrowserWindow, type?: string) => void>(),
}));

describe(openThreadWindow, () => {
  beforeEach(() => {
    electronState.createdWindows.length = 0;
    electronState.loadBarrier = undefined;
    electronState.loadFailure = undefined;
    vi.mocked(readWindowState).mockClear();
    vi.mocked(writeWindowState).mockClear();
  });

  afterEach(() => {
    for (const window of electronState.createdWindows) {
      window.destroy();
    }
  });

  it("loads an account-scoped thread route in a sandboxed window", async () => {
    await openThreadWindow({
      accountId: "person+mail@example.com",
      threadId: "thread/1",
    });
    const [window] = electronState.createdWindows;
    if (window === undefined) {
      throw new Error("Expected a thread window to be created");
    }

    expect(window.options).toMatchObject({
      height: 720,
      minHeight: 420,
      minWidth: 520,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      width: 760,
    });
    expect(window.loadFile).toHaveBeenCalledWith(expect.any(String), {
      hash: "/thread/person%2Bmail%40example.com/thread%2F1",
    });
    expect(readWindowState).toHaveBeenCalledWith("thread");

    window.emit("close");
    expect(writeWindowState).toHaveBeenCalledWith(window, "thread");
  });

  it("focuses the existing window for the same account and thread", async () => {
    const request = {
      accountId: "same@example.com",
      threadId: "same-thread",
    };
    const loadBarrier = Promise.withResolvers<null>();
    electronState.loadBarrier = loadBarrier.promise;

    const firstWindow = openThreadWindow(request);
    const secondWindow = openThreadWindow(request);

    expect(electronState.createdWindows).toHaveLength(1);
    loadBarrier.resolve(null);

    const [first, second] = await Promise.all([firstWindow, secondWindow]);

    expect(second).toBe(first);
    expect(first.focus).toHaveBeenCalledOnce();
  });

  it("destroys the popout when its renderer cannot load", async () => {
    electronState.loadFailure = new Error("load failed");

    await expect(
      openThreadWindow({
        accountId: "failure@example.com",
        threadId: "failure-thread",
      })
    ).rejects.toThrow("load failed");

    expect(electronState.createdWindows[0]?.isDestroyed()).toBeTruthy();
  });
});
