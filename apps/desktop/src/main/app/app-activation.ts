import type { BrowserWindow } from "electron";
import { app } from "electron";

export const registerAppActivation = (
  getWindow: () => BrowserWindow | undefined
): void => {
  app.on("second-instance", () => {
    const window = getWindow();

    if (window === undefined || window.isDestroyed()) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  });
};
