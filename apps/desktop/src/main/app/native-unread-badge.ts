import { app, BrowserWindow, nativeImage } from "electron";

import { createUnreadBadgeBitmap, updateUnreadBadge } from "./unread-badge";

const WINDOWS_BADGE_SIZE = 16;

export const setNativeUnreadBadgeCount = (count: number): void => {
  updateUnreadBadge({
    app,
    count,
    createOverlay: (overlayCount) =>
      nativeImage.createFromBitmap(createUnreadBadgeBitmap(overlayCount), {
        height: WINDOWS_BADGE_SIZE,
        scaleFactor: 1,
        width: WINDOWS_BADGE_SIZE,
      }),
    platform: process.platform,
    windows: BrowserWindow.getAllWindows(),
  });
};
