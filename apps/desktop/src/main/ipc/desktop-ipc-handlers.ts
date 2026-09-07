import * as Effect from "effect/Effect";

import { DesktopIpc } from "./desktop-ipc";
import {
  categorizeMailThread,
  cleanupDraft,
  generateReply,
  getAiWritingSettings,
  listAiProviders,
  updateAiWritingSettings,
} from "./methods/ai";
import { openThreadWindow, startApp, updateAppSettings } from "./methods/app";
import {
  disconnectAccount,
  getGoogleOAuthStatus,
  listAccounts,
  reorderAccounts,
  setupGoogleOAuth,
  startGoogle,
} from "./methods/auth";
import {
  getLoginItemSettings,
  setLoginItemSettings,
} from "./methods/login-item-settings";
import {
  authorizeOutgoingAttachments,
  bulkMutate,
  createLabel,
  deleteLabel,
  deleteForever,
  discardDraft,
  getSpamStatus,
  getSyncStatus,
  loadAttachmentPreview,
  loadOutgoingInlineImagePreview,
  listCachedPage,
  listImageSenders,
  listLabels,
  listSenders,
  listStashedDrafts,
  loadThread,
  loadThreadDraft,
  openAttachmentPreview,
  markThreadNotSpam,
  prepareOutgoingAttachments,
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
  updateLabel,
} from "./methods/mail";
import { getIndexProgress, reindexMail } from "./methods/mail-index";
import {
  beginScheduledMailEdit,
  cancelScheduledMailToStash,
  discardScheduledMail,
  finishScheduledMailEdit,
  getScheduledMailAttentionCount,
  listScheduledMailPage,
  scheduleMail,
  sendScheduledMailNow,
  setScheduledMailOutcomeReadiness,
} from "./methods/scheduled-mail";
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
import { check, download, getStatus, install } from "./methods/updates";

export const installDesktopIpcHandlers = Effect.fn(
  "desktop.ipc.installHandlers"
)(function* installDesktopIpcHandlers() {
  const ipc = yield* DesktopIpc;

  yield* ipc.handle(listAiProviders);
  yield* ipc.handle(getAiWritingSettings);
  yield* ipc.handle(updateAiWritingSettings);
  yield* ipc.handle(generateReply);
  yield* ipc.handle(cleanupDraft);
  yield* ipc.handle(categorizeMailThread);
  yield* ipc.handle(startApp);
  yield* ipc.handle(openThreadWindow);
  yield* ipc.handle(getLoginItemSettings);
  yield* ipc.handle(setLoginItemSettings);
  yield* ipc.handle(updateAppSettings);
  yield* ipc.handle(getGoogleOAuthStatus);
  yield* ipc.handle(setupGoogleOAuth);
  yield* ipc.handle(startGoogle);
  yield* ipc.handle(listAccounts);
  yield* ipc.handle(reorderAccounts);
  yield* ipc.handle(disconnectAccount);
  yield* ipc.handle(listTemplates);
  yield* ipc.handle(saveTemplate);
  yield* ipc.handle(deleteTemplate);
  yield* ipc.handle(getSyncStatus);
  yield* ipc.handle(getIndexProgress);
  yield* ipc.handle(reindexMail);
  yield* ipc.handle(getSpamStatus);
  yield* ipc.handle(listCachedPage);
  yield* ipc.handle(listLabels);
  yield* ipc.handle(createLabel);
  yield* ipc.handle(deleteLabel);
  yield* ipc.handle(updateLabel);
  yield* ipc.handle(syncLabels);
  yield* ipc.handle(loadThread);
  yield* ipc.handle(listStashedDrafts);
  yield* ipc.handle(loadThreadDraft);
  yield* ipc.handle(saveDraft);
  yield* ipc.handle(discardDraft);
  yield* ipc.handle(openAttachmentPreview);
  yield* ipc.handle(authorizeOutgoingAttachments);
  yield* ipc.handle(prepareOutgoingAttachments);
  yield* ipc.handle(loadOutgoingInlineImagePreview);
  yield* ipc.handle(saveAttachment);
  yield* ipc.handle(loadAttachmentPreview);
  yield* ipc.handle(saveAttachmentPreview);
  yield* ipc.handle(searchThreads);
  yield* ipc.handle(sendNew);
  yield* ipc.handle(sendThread);
  yield* ipc.handle(listSenders);
  yield* ipc.handle(bulkMutate);
  yield* ipc.handle(setLabel);
  yield* ipc.handle(setReadState);
  yield* ipc.handle(trash);
  yield* ipc.handle(deleteForever);
  yield* ipc.handle(markThreadNotSpam);
  yield* ipc.handle(listImageSenders);
  yield* ipc.handle(trustImages);
  yield* ipc.handle(listScheduledMailPage);
  yield* ipc.handle(getScheduledMailAttentionCount);
  yield* ipc.handle(scheduleMail);
  yield* ipc.handle(beginScheduledMailEdit);
  yield* ipc.handle(finishScheduledMailEdit);
  yield* ipc.handle(cancelScheduledMailToStash);
  yield* ipc.handle(discardScheduledMail);
  yield* ipc.handle(sendScheduledMailNow);
  yield* ipc.handle(setScheduledMailOutcomeReadiness);
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
  yield* ipc.handle(download);
  yield* ipc.handle(install);
});
