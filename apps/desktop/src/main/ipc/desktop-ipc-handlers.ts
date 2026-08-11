import * as Effect from "effect/Effect";

import { DesktopIpc } from "./desktop-ipc";
import { openThreadWindow, startApp } from "./methods/app";
import {
  disconnectAccount,
  listAccounts,
  reorderAccounts,
  startGoogle,
} from "./methods/auth";
import {
  discardDraft,
  getIndexProgress,
  getSyncStatus,
  loadAttachmentPreview,
  listCachedPage,
  listImageSenders,
  listLabels,
  listSenders,
  listStashedDrafts,
  loadThread,
  loadThreadDraft,
  openAttachmentPreview,
  searchThreads,
  saveAttachment,
  saveAttachmentPreview,
  saveDraft,
  sendNew,
  sendThread,
  setLabel,
  setReadState,
  syncLabels,
  trash,
  trustImages,
} from "./methods/mail";
import {
  beginImport,
  cancelImport,
  dropImportFile,
  exportRecoveryKey,
  importExistingDatabase,
  listSettings,
  selectImportFile,
  updateSettings,
} from "./methods/settings";
import {
  deleteTemplate,
  listTemplates,
  saveTemplate,
} from "./methods/templates";
import { check, getStatus, install } from "./methods/updates";

export const installDesktopIpcHandlers = Effect.fn(
  "desktop.ipc.installHandlers"
)(function* installDesktopIpcHandlers() {
  const ipc = yield* DesktopIpc;

  yield* ipc.handle(startApp);
  yield* ipc.handle(openThreadWindow);
  yield* ipc.handle(startGoogle);
  yield* ipc.handle(listAccounts);
  yield* ipc.handle(reorderAccounts);
  yield* ipc.handle(disconnectAccount);
  yield* ipc.handle(listTemplates);
  yield* ipc.handle(saveTemplate);
  yield* ipc.handle(deleteTemplate);
  yield* ipc.handle(getSyncStatus);
  yield* ipc.handle(getIndexProgress);
  yield* ipc.handle(listCachedPage);
  yield* ipc.handle(listLabels);
  yield* ipc.handle(syncLabels);
  yield* ipc.handle(loadThread);
  yield* ipc.handle(listStashedDrafts);
  yield* ipc.handle(loadThreadDraft);
  yield* ipc.handle(saveDraft);
  yield* ipc.handle(discardDraft);
  yield* ipc.handle(openAttachmentPreview);
  yield* ipc.handle(saveAttachment);
  yield* ipc.handle(loadAttachmentPreview);
  yield* ipc.handle(saveAttachmentPreview);
  yield* ipc.handle(searchThreads);
  yield* ipc.handle(sendNew);
  yield* ipc.handle(sendThread);
  yield* ipc.handle(listSenders);
  yield* ipc.handle(setLabel);
  yield* ipc.handle(setReadState);
  yield* ipc.handle(trash);
  yield* ipc.handle(listImageSenders);
  yield* ipc.handle(trustImages);
  yield* ipc.handle(beginImport);
  yield* ipc.handle(cancelImport);
  yield* ipc.handle(dropImportFile);
  yield* ipc.handle(exportRecoveryKey);
  yield* ipc.handle(importExistingDatabase);
  yield* ipc.handle(selectImportFile);
  yield* ipc.handle(listSettings);
  yield* ipc.handle(updateSettings);
  yield* ipc.handle(getStatus);
  yield* ipc.handle(check);
  yield* ipc.handle(install);
});
