/// <reference types="electron-vite/node" />

import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  destroyBackgroundTray,
  setBackgroundTray,
} from "../src/main/window/tray";

interface TestImage {
  readonly resize: ReturnType<
    typeof vi.fn<(size: Electron.ResizeOptions) => TestImage>
  >;
  readonly setTemplateImage: ReturnType<
    typeof vi.fn<(template: boolean) => void>
  >;
}

interface TestTray {
  readonly destroy: ReturnType<typeof vi.fn<() => void>>;
  readonly image: Electron.NativeImage;
  readonly setContextMenu: ReturnType<
    typeof vi.fn<(menu: Electron.Menu | null) => void>
  >;
  readonly setToolTip: ReturnType<typeof vi.fn<(toolTip: string) => void>>;
}

const electronState = vi.hoisted(() => {
  const image = {
    resize: vi.fn<(size: Electron.ResizeOptions) => TestImage>(),
    setTemplateImage: vi.fn<(template: boolean) => void>(),
  } as TestImage;
  image.resize.mockReturnValue(image);

  return {
    createFromPath: vi.fn<(path: string) => TestImage>(() => image),
    image,
    trays: [] as TestTray[],
  };
});

vi.mock("electron", () => {
  class Tray {
    readonly destroy = vi.fn<() => void>();
    readonly image: Electron.NativeImage;
    readonly setContextMenu = vi.fn<(menu: Electron.Menu | null) => void>();
    readonly setToolTip = vi.fn<(toolTip: string) => void>();

    constructor(image: Electron.NativeImage) {
      this.image = image;
      electronState.trays.push(this);
    }
  }

  return {
    Menu: {
      buildFromTemplate: vi.fn<
        (template: Electron.MenuItemConstructorOptions[]) => Electron.Menu
      >(() => ({}) as Electron.Menu),
    },
    Tray,
    app: { quit: vi.fn<() => void>() },
    nativeImage: {
      createFromPath: electronState.createFromPath,
    },
  };
});

describe("background tray", () => {
  beforeEach(() => {
    destroyBackgroundTray();
    electronState.createFromPath.mockClear();
    electronState.image.resize.mockClear();
    electronState.image.setTemplateImage.mockClear();
    electronState.trays.length = 0;
  });

  afterEach(() => {
    destroyBackgroundTray();
  });

  it("uses the dedicated monochrome tray asset", () => {
    setBackgroundTray(true, () => undefined);

    expect(electronState.createFromPath).toHaveBeenCalledOnce();
    expect(electronState.createFromPath.mock.calls[0]?.[0]).toContain(
      "tray-icon.png"
    );
    expect(electronState.image.resize).toHaveBeenCalledWith({
      height: process.platform === "darwin" ? 14 : 16,
    });
    expect(electronState.trays).toHaveLength(1);

    if (process.platform === "darwin") {
      expect(electronState.image.setTemplateImage).toHaveBeenCalledWith(true);
    } else {
      expect(electronState.image.setTemplateImage).not.toHaveBeenCalled();
    }
  });
});
