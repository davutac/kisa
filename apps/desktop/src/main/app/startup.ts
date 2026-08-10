import { Effect, Exit, Option } from "effect";

import type {
  AppStartupErrorPayload,
  AppStartupReply,
} from "../../shared/ipc/app";
import { startDatabase } from "../database";
import type { DatabaseError } from "../database";
import { startMailBackfill } from "../mail/mail-backfill";
import { warmCorrespondentCache } from "../mail/mail-search";
import { startMailSync } from "../mail/mail-sync";
import { refreshUnreadBadge } from "../mail/unread-badge";

let startupPromise: Promise<AppStartupExit> | null = null;
const CORRESPONDENT_WARM_DELAY_MS = 1000;

type AppStartupError = DatabaseError;
type AppStartupExit = Exit.Exit<void, AppStartupError>;

const runStartupOnce = async (): Promise<AppStartupExit> => {
  const exit = await Effect.runPromiseExit(startDatabase());

  if (Exit.isFailure(exit)) {
    startupPromise = null;
  } else {
    await Effect.runPromise(refreshUnreadBadge().pipe(Effect.ignore));
    startMailSync();
    // Picks up any account whose index was still running when the app last
    // closed, and seeds the renderer's progress state for the rest.
    void Effect.runPromise(startMailBackfill().pipe(Effect.ignore));
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
    return { ok: true };
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
