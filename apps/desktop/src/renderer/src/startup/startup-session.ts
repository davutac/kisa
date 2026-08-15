import type { AppStartupApi } from "@/platform/desktop";
import type { AppSettings, AppStartupReply } from "@/shared/ipc/app";

type StartupAdapter = AppStartupApi;

export type StartupSessionOutcome =
  | { state: "aborted" }
  | { state: "failed"; message: string }
  | { appSettings?: AppSettings; state: "started" };

interface RequestStartupSessionArgs {
  abortSignal?: AbortSignal;
  startupAdapter?: StartupAdapter;
}

const DEFAULT_STARTUP_ERROR_MESSAGE = "Could not start the app";

const isAborted = (abortSignal?: AbortSignal): boolean =>
  abortSignal?.aborted === true;

const toOutcome = (reply: AppStartupReply): StartupSessionOutcome => {
  if (reply.ok) {
    return { appSettings: reply.appSettings, state: "started" };
  }

  return {
    message: reply.error.message || DEFAULT_STARTUP_ERROR_MESSAGE,
    state: "failed",
  };
};

export const requestStartupSession = async ({
  abortSignal,
  startupAdapter,
}: RequestStartupSessionArgs): Promise<StartupSessionOutcome> => {
  if (isAborted(abortSignal)) {
    return { state: "aborted" };
  }

  if (startupAdapter === undefined) {
    return { state: "started" };
  }

  let reply: AppStartupReply;

  try {
    reply = await startupAdapter.start();
  } catch {
    return { message: DEFAULT_STARTUP_ERROR_MESSAGE, state: "failed" };
  }

  if (isAborted(abortSignal)) {
    return { state: "aborted" };
  }

  return toOutcome(reply);
};
