import { nativeTheme } from "electron";

import type { AppTheme } from "../../shared/ipc/app";

/**
 * Tells Electron which appearance the app is in. Until it is told, Electron
 * follows the system: native menus and window chrome would stay light in a
 * dark app, and `prefers-color-scheme` in every frame would answer for the
 * system, so a message's own dark-mode rule would follow the wrong one.
 */
export const setNativeTheme = (theme: AppTheme): void => {
  nativeTheme.themeSource = theme;
};
