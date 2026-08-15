interface DockVisibility {
  readonly hide: () => void;
  readonly isVisible: () => boolean;
  readonly show: () => Promise<void>;
}

interface AppWindowVisibility {
  readonly isDestroyed: () => boolean;
  readonly isVisible: () => boolean;
}

interface TaskbarWindow {
  readonly setSkipTaskbar: (skip: boolean) => void;
}

interface UpdateDockVisibilityOptions {
  readonly dock?: DockVisibility;
  readonly platform: NodeJS.Platform;
  readonly windows: readonly AppWindowVisibility[];
}

export const updateDockVisibility = ({
  dock,
  platform,
  windows,
}: UpdateDockVisibilityOptions): boolean => {
  const hasVisibleWindow = windows.some(
    (window) => !window.isDestroyed() && window.isVisible()
  );

  if (platform !== "darwin" || dock === undefined) {
    return hasVisibleWindow;
  }

  if (hasVisibleWindow) {
    if (!dock.isVisible()) {
      void dock.show();
    }
    return true;
  }

  if (dock.isVisible()) {
    dock.hide();
  }

  return false;
};

export const setWindowTaskbarVisibility = (
  window: TaskbarWindow,
  visible: boolean,
  platform: NodeJS.Platform
): void => {
  if (platform === "darwin" || platform === "win32") {
    window.setSkipTaskbar(!visible);
  }
};
