import { Effect, Exit, Option } from "effect";

import type {
  AppStartupErrorPayload,
  AppStartupReply,
} from "../../shared/ipc/app";
import { startDatabase } from "../database";
import type { DatabaseError } from "../database";
import { startMailSync } from "../mail/mail-sync";

let startupPromise: Promise<AppStartupExit> | null = null;

type AppStartupError = DatabaseError;
type AppStartupExit = Exit.Exit<void, AppStartupError>;

const runStartupOnce = async (): Promise<AppStartupExit> => {
  const exit = await Effect.runPromiseExit(startDatabase());

  if (Exit.isFailure(exit)) {
    startupPromise = null;
  } else {
    startMailSync();
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
