import * as Effect from "effect/Effect";

import { DesktopIpc } from "./desktop-ipc";
import { startApp } from "./methods/app";
import { disconnectAccount, listAccounts, startGoogle } from "./methods/auth";
import {
  getIndexProgress,
  getSyncStatus,
  listCachedPage,
  listImageSenders,
  listLabels,
  loadPage,
  loadThread,
  setReadState,
  syncLabels,
  trash,
  trustImages,
} from "./methods/mail";
import { listSettings, updateSettings } from "./methods/settings";
import { check, getStatus, install } from "./methods/updates";

export const installDesktopIpcHandlers = Effect.fn(
  "desktop.ipc.installHandlers"
)(function* installDesktopIpcHandlers() {
  const ipc = yield* DesktopIpc;

  yield* ipc.handle(startApp);
  yield* ipc.handle(startGoogle);
  yield* ipc.handle(listAccounts);
  yield* ipc.handle(disconnectAccount);
  yield* ipc.handle(getSyncStatus);
  yield* ipc.handle(getIndexProgress);
  yield* ipc.handle(listCachedPage);
  yield* ipc.handle(listLabels);
  yield* ipc.handle(syncLabels);
  yield* ipc.handle(loadPage);
  yield* ipc.handle(loadThread);
  yield* ipc.handle(setReadState);
  yield* ipc.handle(trash);
  yield* ipc.handle(listImageSenders);
  yield* ipc.handle(trustImages);
  yield* ipc.handle(listSettings);
  yield* ipc.handle(updateSettings);
  yield* ipc.handle(getStatus);
  yield* ipc.handle(check);
  yield* ipc.handle(install);
});
