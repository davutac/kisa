import { app } from "electron";

import type { LoginItemSettings } from "../../shared/ipc/app";

export const readLoginItemSettings = (): LoginItemSettings => {
  const settings = app.getLoginItemSettings();

  if (process.platform === "darwin") {
    const requiresApproval = settings.status === "requires-approval";

    return {
      openAtLogin: settings.openAtLogin && !requiresApproval,
      requiresApproval,
    };
  }

  return {
    openAtLogin:
      process.platform === "win32" && settings.executableWillLaunchAtLogin,
    requiresApproval: false,
  };
};

export const updateLoginItemSettings = (
  openAtLogin: boolean
): LoginItemSettings => {
  app.setLoginItemSettings({ openAtLogin });
  return readLoginItemSettings();
};
