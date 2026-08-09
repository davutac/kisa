/// <reference types="electron-vite/node" />

import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { openThreadWindow } from "../src/main/window/create-window";

interface TestWindow {
  readonly destroy: () => void;
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

vi.mock(import("electron"), () => ({
  BrowserWindow: class BrowserWindow {
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

    isDestroyed(): boolean {
      return this.destroyed;
    }

    on(event: string, handler: () => void): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }
  } as unknown as typeof Electron.BrowserWindow,
}));

vi.mock(import("@electron-toolkit/utils"), () => ({ is: { dev: false } }));
vi.mock(import("../src/main/app/native-mail-index-progress"), () => ({
  applyNativeMailIndexProgress:
    vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/electron/shell"), () => ({
  openExternalUrl: vi.fn<(rawUrl: unknown) => boolean>(() => true),
}));
vi.mock(import("../src/main/updates/updater"), () => ({
  initializeAutoUpdates: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/window/native-context-menu"), () => ({
  installNativeContextMenu: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/window/window-state"), () => ({
  MIN_WINDOW_SIZE: { height: 560, width: 860 } as const,
  readWindowState: vi.fn<() => { height: number; width: number }>(() => ({
    height: 670,
    width: 900,
  })),
  writeWindowState: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));

describe(openThreadWindow, () => {
  beforeEach(() => {
    electronState.createdWindows.length = 0;
    electronState.loadBarrier = undefined;
    electronState.loadFailure = undefined;
  });

  afterEach(() => {
    for (const window of electronState.createdWindows) {
      window.destroy();
    }
  });

  it("loads an account-scoped thread route in a sandboxed window", async () => {
    const window = (await openThreadWindow({
      accountId: "person+mail@example.com",
      threadId: "thread/1",
    })) as unknown as TestWindow;

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

    const [first, second] = (await Promise.all([
      firstWindow,
      secondWindow,
    ])) as unknown as [TestWindow, TestWindow];

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
