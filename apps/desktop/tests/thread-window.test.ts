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
  loadBarrier: undefined as Promise<void> | undefined,
  loadFailure: undefined as Error | undefined,
}));

vi.mock(import("electron"), () => ({
  BrowserWindow: class BrowserWindow {
    readonly focus = vi.fn();
    readonly loadFile = vi.fn(async () => {
      await electronState.loadBarrier;

      if (electronState.loadFailure !== undefined) {
        throw electronState.loadFailure;
      }
    });
    readonly loadURL = vi.fn(async () => {});
    readonly options: Electron.BrowserWindowConstructorOptions;
    readonly webContents = {
      getURL: vi.fn(() => "file:///index.html"),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    private destroyed = false;
    private readonly handlers = new Map<string, Array<() => void>>();

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

    isMinimized(): boolean {
      return false;
    }

    on(event: string, handler: () => void): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }

    restore(): void {}

    show(): void {}
  } as unknown as typeof Electron.BrowserWindow,
}));

vi.mock(import("@electron-toolkit/utils"), () => ({ is: { dev: false } }));
vi.mock(import("../src/main/app/native-mail-index-progress"), () => ({
  applyNativeMailIndexProgress: vi.fn(),
}));
vi.mock(import("../src/main/electron/shell"), () => ({
  openExternalUrl: vi.fn(),
}));
vi.mock(import("../src/main/updates/updater"), () => ({
  initializeAutoUpdates: vi.fn(),
}));
vi.mock(import("../src/main/window/native-context-menu"), () => ({
  installNativeContextMenu: vi.fn(),
}));
vi.mock(import("../src/main/window/window-state"), () => ({
  MIN_WINDOW_SIZE: { height: 560, width: 860 },
  readWindowState: vi.fn(() => ({ height: 670, width: 900 })),
  writeWindowState: vi.fn(),
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
    let finishLoading = (): void => {};
    electronState.loadBarrier = new Promise((resolve) => {
      finishLoading = resolve;
    });

    const firstWindow = openThreadWindow(request);
    const secondWindow = openThreadWindow(request);

    expect(electronState.createdWindows).toHaveLength(1);
    finishLoading();

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
