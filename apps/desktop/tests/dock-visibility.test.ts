import { describe, expect, it, vi } from "vitest";

import {
  setWindowTaskbarVisibility,
  updateDockVisibility,
} from "../src/main/app/background-visibility";

const createDock = (initiallyVisible = true) => {
  let visible = initiallyVisible;

  return {
    hide: vi.fn<() => void>(() => {
      visible = false;
    }),
    isVisible: vi.fn<() => boolean>(() => visible),
    show: vi.fn<() => Promise<void>>(() => {
      visible = true;
      return Promise.resolve();
    }),
  };
};

const createWindow = (visible: boolean, destroyed = false) => ({
  isDestroyed: () => destroyed,
  isVisible: () => visible,
});

describe(updateDockVisibility, () => {
  it("hides the macOS Dock icon when no app windows are visible", () => {
    const dock = createDock();

    const hasVisibleWindow = updateDockVisibility({
      dock,
      platform: "darwin",
      windows: [createWindow(false), createWindow(true, true)],
    });

    expect(hasVisibleWindow).toBeFalsy();
    expect(dock.hide).toHaveBeenCalledOnce();
    expect(dock.show).not.toHaveBeenCalled();
  });

  it("shows the macOS Dock icon while any app window is visible", () => {
    const dock = createDock(false);

    const hasVisibleWindow = updateDockVisibility({
      dock,
      platform: "darwin",
      windows: [createWindow(false), createWindow(true)],
    });

    expect(hasVisibleWindow).toBeTruthy();
    expect(dock.show).toHaveBeenCalledOnce();
    expect(dock.hide).not.toHaveBeenCalled();
  });

  it("does not repeat a Dock visibility operation already in effect", () => {
    const visibleDock = createDock();
    const hiddenDock = createDock(false);

    updateDockVisibility({
      dock: visibleDock,
      platform: "darwin",
      windows: [createWindow(true)],
    });
    updateDockVisibility({
      dock: hiddenDock,
      platform: "darwin",
      windows: [createWindow(false)],
    });

    expect(visibleDock.show).not.toHaveBeenCalled();
    expect(hiddenDock.hide).not.toHaveBeenCalled();
  });

  it("does not manage Dock visibility on Windows or Linux", () => {
    const dock = createDock();

    updateDockVisibility({ dock, platform: "win32", windows: [] });
    updateDockVisibility({ dock, platform: "linux", windows: [] });

    expect(dock.hide).not.toHaveBeenCalled();
    expect(dock.show).not.toHaveBeenCalled();
  });
});

describe(setWindowTaskbarVisibility, () => {
  it.each(["darwin", "win32"] as const)(
    "shows every visible window, including thread windows, in the %s taskbar",
    (platform) => {
      const window = { setSkipTaskbar: vi.fn<(skip: boolean) => void>() };

      setWindowTaskbarVisibility(window, true, platform);

      expect(window.setSkipTaskbar).toHaveBeenCalledWith(false);
    }
  );

  it("removes only a backgrounded window from the taskbar", () => {
    const window = { setSkipTaskbar: vi.fn<(skip: boolean) => void>() };

    setWindowTaskbarVisibility(window, false, "darwin");

    expect(window.setSkipTaskbar).toHaveBeenCalledWith(true);
  });

  it("leaves Linux taskbar visibility to the window manager", () => {
    const window = { setSkipTaskbar: vi.fn<(skip: boolean) => void>() };

    setWindowTaskbarVisibility(window, true, "linux");

    expect(window.setSkipTaskbar).not.toHaveBeenCalled();
  });
});
