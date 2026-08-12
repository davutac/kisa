/// <reference types="electron-vite/node" />

import type * as Electron from "electron";
import type {
  ContextMenuParams,
  MenuItemConstructorOptions,
  PopupOptions,
} from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWindow } from "../src/main/window/create-window";

const electronState = vi.hoisted(() => ({
  builtTemplates: [] as MenuItemConstructorOptions[][],
  handlers: new Map<string, (...args: never[]) => void>(),
  popup: vi.fn<(options?: PopupOptions) => void>(),
}));

vi.mock(import("electron"), async (importOriginal) => {
  const original = await importOriginal();
  class BrowserWindow {
    webContents = {
      getURL: vi.fn<() => string>(() => "file:///index.html"),
      on: vi.fn<(event: string, handler: (...args: never[]) => void) => void>(
        (event, handler) => {
          electronState.handlers.set(event, handler);
        }
      ),
      setWindowOpenHandler:
        vi.fn<
          (
            handler: Parameters<Electron.WebContents["setWindowOpenHandler"]>[0]
          ) => void
        >(),
    };

    loadFile = vi.fn<(filePath: string) => void>();
    loadURL = vi.fn<(url: string) => void>();
    maximize = vi.fn<() => void>();
    on = vi.fn<(event: string, listener: () => void) => void>();
    show = vi.fn<() => void>();
  }

  return {
    ...original,
    BrowserWindow: Object.assign(BrowserWindow, original.BrowserWindow),
    Menu: Object.assign(vi.fn(), original.Menu, {
      buildFromTemplate: vi.fn<
        (template: MenuItemConstructorOptions[]) => {
          popup: typeof electronState.popup;
        }
      >((template) => {
        electronState.builtTemplates.push(template);
        return { popup: electronState.popup };
      }),
    }),
  };
});

vi.mock(import("@electron-toolkit/utils"), () => ({ is: { dev: false } }));
vi.mock(import("../src/main/app/native-mail-index-progress"), () => ({
  applyNativeMailIndexProgress:
    vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/electron/shell"), () => ({
  openExternalUrl: vi.fn<(url: string) => boolean>(),
}));
vi.mock(import("../src/main/updates/updater"), () => ({
  initializeAutoUpdates: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));
vi.mock(import("../src/main/window/window-state"), () => ({
  MIN_WINDOW_SIZE: { height: 560, width: 860 } as const,
  readWindowState: vi.fn<
    () => { height: number; isMaximized: boolean; width: number }
  >(() => ({ height: 670, isMaximized: false, width: 900 })),
  writeWindowState: vi.fn<(window: Electron.BrowserWindow) => void>(),
}));

const contextMenuParams = (
  patch: Partial<ContextMenuParams> = {}
): ContextMenuParams =>
  ({
    editFlags: {
      canCopy: false,
      canCut: false,
      canDelete: false,
      canEditRichly: false,
      canPaste: false,
      canRedo: false,
      canSelectAll: true,
      canUndo: false,
    },
    frame: null,
    isEditable: false,
    selectionText: "",
    ...patch,
  }) as ContextMenuParams;

describe("native context menu", () => {
  beforeEach(() => {
    electronState.builtTemplates.length = 0;
    electronState.handlers.clear();
    electronState.popup.mockClear();
  });

  it("shows native copy actions for selected text", () => {
    const window = createWindow();
    const frame = {} as ContextMenuParams["frame"];

    electronState.handlers.get("context-menu")?.(
      {} as never,
      contextMenuParams({
        editFlags: {
          ...contextMenuParams().editFlags,
          canCopy: true,
        },
        frame,
        selectionText: "Selected text",
      }) as never
    );

    expect(electronState.builtTemplates).toStrictEqual([
      [
        { enabled: true, role: "copy" },
        { type: "separator" },
        { enabled: true, role: "selectAll" },
      ],
    ]);
    expect(electronState.popup).toHaveBeenCalledWith({ frame, window });
  });

  it("does not open a menu for a non-editable surface without a selection", () => {
    createWindow();

    electronState.handlers.get("context-menu")?.(
      null as never,
      contextMenuParams() as never
    );

    expect(electronState.builtTemplates).toStrictEqual([]);
    expect(electronState.popup).not.toHaveBeenCalled();
  });

  it("shows standard edit actions for editable text", () => {
    createWindow();

    electronState.handlers.get("context-menu")?.(
      {} as never,
      contextMenuParams({
        editFlags: {
          ...contextMenuParams().editFlags,
          canCopy: true,
          canCut: true,
          canPaste: true,
          canUndo: true,
        },
        isEditable: true,
        selectionText: "Draft",
      }) as never
    );

    expect(electronState.builtTemplates[0]).toStrictEqual([
      { enabled: true, role: "undo" },
      { enabled: false, role: "redo" },
      { type: "separator" },
      { enabled: true, role: "cut" },
      { enabled: true, role: "copy" },
      { enabled: true, role: "paste" },
      { enabled: true, role: "pasteAndMatchStyle" },
      { enabled: false, role: "delete" },
      { type: "separator" },
      { enabled: true, role: "selectAll" },
    ]);
  });
});
