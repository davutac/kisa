import { BrowserWindow } from "electron";

import type { GmailIndexProgress } from "../../shared/ipc/mail";
import {
  getNativeMailIndexProgress,
  HIDDEN_MAIL_INDEX_PROGRESS,
} from "./mail-index-progress";

let currentProgress = HIDDEN_MAIL_INDEX_PROGRESS;

export const applyNativeMailIndexProgress = (window: BrowserWindow): void => {
  window.setProgressBar(currentProgress);
};

export const setNativeMailIndexProgress = (
  progress: readonly GmailIndexProgress[]
): void => {
  currentProgress = getNativeMailIndexProgress(progress);

  for (const window of BrowserWindow.getAllWindows()) {
    applyNativeMailIndexProgress(window);
  }
};
