import { Effect, Exit, Option } from "effect";
import { app, dialog } from "electron";

import type {
  AppStartupErrorPayload,
  AppStartupReply,
} from "../../shared/ipc/app";
import { startThreadCategorization } from "../ai/thread-categorization";
import { startDatabase, takeImportActivation } from "../database";
import type { DatabaseError } from "../database";
import { configureDraftAttachmentStore } from "../mail/draft-attachment-store";
import { startMailEngine, syncOnFocus } from "../mail/engine/mail-engine";
import { reconcileDraftAttachmentStore } from "../mail/mail-drafts";
import { warmCorrespondentCache } from "../mail/mail-search";
import {
  adoptLegacyScheduledMailAttachments,
  startScheduledMail,
} from "../mail/scheduled-mail";
import { refreshUnreadBadge } from "../mail/unread-badge";
import { getCurrentAppSettings } from "../settings/app-settings";
import { getMainWindow } from "../window/create-window";
import { announceImportActivation } from "./import-activation-notice";

let startupPromise: Promise<AppStartupExit> | null = null;
const CORRESPONDENT_WARM_DELAY_MS = 1000;

type AppStartupError = DatabaseError;
type AppStartupExit = Exit.Exit<void, AppStartupError>;

const runStartupOnce = async (): Promise<AppStartupExit> => {
  const exit = await Effect.runPromiseExit(startDatabase());
  // Whether or not the database then opened: the import was the reason for
  // this restart, and it did not happen.
  announceImportActivation(takeImportActivation(), {
    getWindow: getMainWindow,
    show: (window, notice) => {
      void dialog.showMessageBox(window, {
        buttons: ["OK"],
        detail: notice.detail,
        message: notice.message,
        noLink: true,
        type: "warning",
      });
    },
  });

  if (Exit.isFailure(exit)) {
    startupPromise = null;
  } else {
    configureDraftAttachmentStore(app.getPath("userData"));
    await Effect.runPromise(
      Effect.gen(function* prepareMailState() {
        yield* adoptLegacyScheduledMailAttachments().pipe(Effect.ignore);
        yield* reconcileDraftAttachmentStore().pipe(Effect.ignore);
        yield* refreshUnreadBadge().pipe(Effect.ignore);
      })
    );
    startThreadCategorization();
    void startMailEngine();
    app.on("browser-window-focus", syncOnFocus);
    void startScheduledMail();
    // Give the first mailbox page priority over this one-time full-index scan.
    const warmTimer = setTimeout(() => {
      void Effect.runPromise(warmCorrespondentCache().pipe(Effect.ignore));
    }, CORRESPONDENT_WARM_DELAY_MS);
    warmTimer.unref();
  }

  return exit;
};

export const startApp = (): Promise<AppStartupExit> => {
  startupPromise ??= runStartupOnce();

  return startupPromise;
};

const serializeStartupError = (
  error: AppStartupError
): AppStartupErrorPayload => ({
  message: error.message,
  reason: error.reason,
  tag: error._tag,
});

const toStartupReply = (exit: AppStartupExit): AppStartupReply => {
  if (Exit.isSuccess(exit)) {
    return { appSettings: getCurrentAppSettings(), ok: true };
  }

  const error = Option.getOrUndefined(Exit.findErrorOption(exit));

  if (error === undefined) {
    return {
      error: { message: "Application startup failed" },
      ok: false,
    };
  }

  return {
    error: serializeStartupError(error),
    ok: false,
  };
};

export const getAppStartupReply = async (): Promise<AppStartupReply> =>
  toStartupReply(await startApp());
