import path from "node:path";

import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WindowStateType } from "../src/main/window/window-state";
import {
  readWindowState,
  writeWindowState,
} from "../src/main/window/window-state";

const fileState = vi.hoisted(() => ({
  files: new Map<string, string>(),
}));

// Partial adapters keep persistence tests away from live app data.
// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("node:fs", () => ({
  existsSync: (filePath: string) => fileState.files.has(filePath),
  mkdirSync: vi.fn<() => void>(),
  readFileSync: (filePath: string) => {
    const contents = fileState.files.get(filePath);
    if (contents === undefined) {
      throw new Error(`Missing test file: ${filePath}`);
    }
    return contents;
  },
  writeFileSync: (filePath: string, contents: string) => {
    fileState.files.set(filePath, contents);
  },
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("electron", () => ({
  app: { getPath: () => "/test/user-data" },
  screen: {
    getAllDisplays: () => [
      { workArea: { height: 1080, width: 1920, x: 0, y: 0 } },
    ],
  },
}));

const createWindow = (
  bounds: Electron.Rectangle,
  isMaximized = false
): Electron.BrowserWindow =>
  ({
    getBounds: () => bounds,
    getNormalBounds: () => bounds,
    isFullScreen: () => false,
    isMaximized: () => isMaximized,
    isMinimized: () => false,
  }) as Electron.BrowserWindow;

describe("window state", () => {
  beforeEach(() => {
    fileState.files.clear();
  });

  it("uses independent defaults for every window type", () => {
    expect(readWindowState("main")).toMatchObject({
      height: 670,
      width: 900,
    });
    expect(readWindowState("thread")).toMatchObject({
      height: 720,
      width: 760,
    });
    expect(readWindowState("attachment-preview")).toMatchObject({
      height: 760,
      width: 920,
    });
  });

  it("persists each type to its own state file", () => {
    const cases: readonly (readonly [
      WindowStateType,
      string,
      Electron.Rectangle,
    ])[] = [
      ["main", "window-state.json", { height: 700, width: 1000, x: 10, y: 20 }],
      [
        "thread",
        "thread-window-state.json",
        { height: 710, width: 800, x: 30, y: 40 },
      ],
      [
        "attachment-preview",
        "attachment-preview-window-state.json",
        { height: 720, width: 810, x: 50, y: 60 },
      ],
    ];

    for (const [type, filename, bounds] of cases) {
      writeWindowState(createWindow(bounds), type);

      expect(
        fileState.files.has(path.join("/test/user-data", filename))
      ).toBeTruthy();
      expect(readWindowState(type)).toMatchObject(bounds);
    }
  });
});
