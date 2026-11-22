import type { AccountsApi, RuntimeCapabilities } from "@/platform/desktop";
import { getRuntimeCapabilities } from "@/platform/desktop";
import type { Account } from "@/shared/ipc/accounts";
import { hydrateAppSettingsState } from "@/state/app-settings";

import { requestStartupSession } from "./startup-session";

export type AuthGateState =
  | {
      accounts: readonly Account[];
      status: "authenticated";
    }
  | { status: "unauthenticated" };

type AuthGateCapabilities = Pick<RuntimeCapabilities, "isWeb" | "startup"> & {
  accounts?: Pick<AccountsApi, "listAccounts">;
};

const loadAuthGateState = async (
  capabilities: AuthGateCapabilities
): Promise<AuthGateState> => {
  const startup = await requestStartupSession({
    startupAdapter: capabilities.startup,
  });

  if (startup.state === "failed") {
    throw new Error(startup.message);
  }

  if (startup.state === "aborted") {
    throw new Error("Application startup was cancelled");
  }

  if (startup.appSettings !== undefined) {
    hydrateAppSettingsState(startup.appSettings);
  }

  if (capabilities.accounts === undefined) {
    if (!capabilities.isWeb) {
      throw new Error(
        "The Electron preload bridge did not load. Restart the desktop app."
      );
    }

    return { accounts: [], status: "authenticated" };
  }

  const reply = await capabilities.accounts.listAccounts();

  if (!reply.ok) {
    throw new Error(reply.error);
  }

  return reply.data.length > 0
    ? { accounts: reply.data, status: "authenticated" }
    : { status: "unauthenticated" };
};

export const createAuthGateStateResolver = (
  load: () => Promise<AuthGateState>
): (() => Promise<AuthGateState>) => {
  let authenticatedState: AuthGateState | undefined;
  let pending: Promise<AuthGateState> | undefined;
  let pendingToken: object | undefined;

  return () => {
    if (authenticatedState?.status === "authenticated") {
      return Promise.resolve(authenticatedState);
    }

    if (pending !== undefined) {
      return pending;
    }

    const loadTask = load();
    const token = {};
    const next = (async () => {
      try {
        const state = await loadTask;

        if (state.status === "authenticated") {
          authenticatedState = state;
        }

        return state;
      } finally {
        if (pendingToken === token) {
          pending = undefined;
          pendingToken = undefined;
        }
      }
    })();
    pending = next;
    pendingToken = token;

    return next;
  };
};

const resolveDefaultAuthGateState = createAuthGateStateResolver(() =>
  loadAuthGateState(getRuntimeCapabilities())
);

export const resolveInitialAuthGateState = (
  capabilities?: AuthGateCapabilities
): Promise<AuthGateState> =>
  capabilities === undefined
    ? resolveDefaultAuthGateState()
    : loadAuthGateState(capabilities);
