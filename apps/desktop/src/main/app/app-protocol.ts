import path from "node:path";

import type { BrowserWindow } from "electron";
import { app } from "electron";

import {
  APP_PROTOCOL,
  findAppProtocolUrl,
  parseGoogleAuthCallback,
} from "../../shared/app-protocol";
import type { GoogleAuthCallback } from "../../shared/ipc/auth";

interface AppProtocolOptions {
  readonly getWindow: () => BrowserWindow | undefined;
  readonly onGoogleCallback?: (
    result: GoogleAuthCallback
  ) => Promise<void> | void;
}

export const registerAppProtocol = ({
  getWindow,
  onGoogleCallback,
}: AppProtocolOptions): void => {
  const focusWindow = (): void => {
    const window = getWindow();

    if (window === undefined || window.isDestroyed()) {
      return;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.show();
    window.focus();
  };

  const handleUrl = (rawUrl: string): boolean => {
    const callback = parseGoogleAuthCallback(rawUrl);

    if (callback === undefined) {
      return false;
    }

    void onGoogleCallback?.(callback);

    focusWindow();
    return true;
  };

  if (process.defaultApp && process.argv[1] !== undefined) {
    app.setAsDefaultProtocolClient(APP_PROTOCOL, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(APP_PROTOCOL);
  }

  app.on("open-url", (event, rawUrl) => {
    if (handleUrl(rawUrl)) {
      event.preventDefault();
    }
  });

  app.on("second-instance", (_event, commandLine) => {
    const rawUrl = findAppProtocolUrl(commandLine);

    if (rawUrl !== undefined) {
      handleUrl(rawUrl);
      return;
    }

    focusWindow();
  });

  const initialUrl = findAppProtocolUrl(process.argv);

  if (initialUrl !== undefined) {
    handleUrl(initialUrl);
  }
};
