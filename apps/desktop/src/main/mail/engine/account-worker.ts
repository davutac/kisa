import { Cause, Exit, Result } from "effect";

/**
 * What one account's background loop is doing. `syncing` is the catch-up pass
 * that opens every cycle and `indexing` the skeleton and body work after it;
 * the other phases are waits, each with its own rule for what ends it.
 * `syncing` begins when the cycle does, so it also covers connecting.
 */
export type AccountWorkerPhase =
  | { readonly kind: "idle"; readonly until: number }
  | { readonly kind: "indexing" }
  | { readonly kind: "needs-sign-in" }
  | {
      /** Consecutive failed cycles, this one included. */
      readonly attempt: number;
      readonly kind: "retrying";
      /** The server named the wait, so nothing may cut it short. */
      readonly serverDelay: boolean;
      readonly until: number;
    }
  | { readonly kind: "stopped" }
  | { readonly kind: "syncing" };

export type AccountCycleOutcome =
  | { readonly kind: "account-missing" }
  | { readonly kind: "done"; readonly moreWork: boolean }
  | { readonly kind: "failed"; readonly retryAfterMs?: number }
  | { readonly kind: "sign-in-refused" };

/**
 * Who asked for a sync. `automatic` covers focus, a send and a failed change;
 * it never retries a refused sign-in, which would repeat the refusal on every
 * focus. `user` is Sync now, and `account-connected` a sign-in just verified.
 */
export type SyncRequestSource = "account-connected" | "automatic" | "user";

interface AccountWorkerOptions {
  readonly now: () => number;
  readonly onPhaseChange: (phase: AccountWorkerPhase) => void;
  readonly pollIntervalMs: number;
  readonly retryDelaysMs: readonly number[];
  readonly runCycle: (
    cycle: { readonly syncPassEnded: (caughtUp: boolean) => void },
    signal: AbortSignal
  ) => Promise<AccountCycleOutcome>;
  readonly schedule: (
    run: () => void,
    delayMs: number
  ) => { readonly cancel: () => void };
}

export interface AccountWorker {
  /**
   * The index status this account's trouble overrides: `paused` while it
   * needs a new sign-in, `failed` while its server cannot be reached.
   */
  readonly indexStatus: () => "failed" | "paused" | undefined;
  readonly phase: () => AccountWorkerPhase;
  readonly requestSync: (source: SyncRequestSource) => void;
  /** The loop itself. Resolves once the worker has stopped. */
  readonly run: (signal: AbortSignal) => Promise<void>;
}

const REQUEST_RANK = {
  "account-connected": 2,
  automatic: 0,
  user: 1,
} as const satisfies Record<SyncRequestSource, number>;

export const toCycleOutcome = (
  exit: Exit.Exit<
    { readonly moreWork: boolean },
    { readonly _tag: string; readonly retryAfterMs?: number }
  >
): AccountCycleOutcome => {
  if (Exit.isSuccess(exit)) {
    return { kind: "done", moreWork: exit.value.moreWork };
  }
  const found = Cause.findError(exit.cause);
  const failure = Result.isSuccess(found) ? found.success : undefined;
  if (failure?._tag === "MailAuthError") {
    return { kind: "sign-in-refused" };
  }
  // The engine raises this for an account that is no longer connected.
  if (failure?._tag === "MailEngineError") {
    return { kind: "account-missing" };
  }
  return { kind: "failed", retryAfterMs: failure?.retryAfterMs };
};

/**
 * Keeps one account in step for as long as it is connected: cycle, wait,
 * cycle. Its phase is the only record of what the loop is doing, so what the
 * windows are told is always derived from it.
 *
 * A sync request during a cycle is remembered and earns one more cycle; a
 * request during a wait ends the wait unless the phase says otherwise.
 */
export const createAccountWorker = ({
  now,
  onPhaseChange,
  pollIntervalMs,
  retryDelaysMs,
  runCycle,
  schedule,
}: AccountWorkerOptions): AccountWorker => {
  let phase: AccountWorkerPhase = { kind: "stopped" };
  let failures = 0;
  /** The strongest request that arrived since the running cycle began. */
  let pending: SyncRequestSource | undefined;
  // What keeps the account from catching up, kept apart from the phase: it
  // lasts through the retries and ends only when a catch-up pass works.
  // Every view of indexing reads anything but `running` as not indexing, so
  // trouble that cleared for each retry would blink them, and so would
  // reporting each passing failure: `unreachable` waits for the last step.
  let trouble: "sign-in" | "unreachable" | undefined;
  let caughtUpThisCycle = false;
  let endWait: (() => void) | undefined;

  const setPhase = (next: AccountWorkerPhase): void => {
    phase = next;
    onPhaseChange(next);
  };

  const endsWait = (source: SyncRequestSource): boolean => {
    if (phase.kind === "idle") {
      return true;
    }
    if (phase.kind === "retrying") {
      return !phase.serverDelay;
    }
    return phase.kind === "needs-sign-in" && source !== "automatic";
  };

  const afterCycle = (outcome: AccountCycleOutcome): AccountWorkerPhase => {
    if (outcome.kind === "account-missing") {
      return { kind: "stopped" };
    }
    if (outcome.kind === "done") {
      failures = 0;
      return outcome.moreWork || pending !== undefined
        ? { kind: "syncing" }
        : { kind: "idle", until: now() + pollIntervalMs };
    }
    if (outcome.kind === "sign-in-refused") {
      trouble = "sign-in";
      return pending === undefined || pending === "automatic"
        ? { kind: "needs-sign-in" }
        : { kind: "syncing" };
    }

    failures += 1;
    if (!caughtUpThisCycle && failures >= retryDelaysMs.length) {
      trouble = "unreachable";
    }
    if (outcome.retryAfterMs !== undefined) {
      return {
        attempt: failures,
        kind: "retrying",
        serverDelay: true,
        until: now() + outcome.retryAfterMs,
      };
    }
    if (pending !== undefined) {
      return { kind: "syncing" };
    }
    const delay =
      retryDelaysMs[Math.min(failures, retryDelaysMs.length) - 1] ??
      pollIntervalMs;
    return {
      attempt: failures,
      kind: "retrying",
      serverDelay: false,
      until: now() + delay,
    };
  };

  const wait = async (
    waiting: AccountWorkerPhase,
    signal: AbortSignal
  ): Promise<void> => {
    const ended = Promise.withResolvers<null>();
    const timer =
      "until" in waiting
        ? schedule(() => ended.resolve(null), waiting.until - now())
        : undefined;
    endWait = () => ended.resolve(null);
    if (signal.aborted) {
      ended.resolve(null);
    }
    await ended.promise;
    endWait = undefined;
    timer?.cancel();
  };

  // Disconnect and quit wait for the loop, so abort ends every wait,
  // including the one for a sign-in, which has no timer of its own.
  const endWaitOnAbort = (): void => endWait?.();

  const cycle = async (signal: AbortSignal): Promise<AccountCycleOutcome> => {
    try {
      return await runCycle(
        {
          syncPassEnded: (caughtUp) => {
            if (!caughtUp || phase.kind !== "syncing") {
              return;
            }
            caughtUpThisCycle = true;
            trouble = undefined;
            setPhase({ kind: "indexing" });
          },
        },
        signal
      );
    } catch {
      return { kind: "failed" };
    }
  };

  return {
    indexStatus: () => {
      if (trouble === "sign-in") {
        return "paused";
      }
      return trouble === "unreachable" ? "failed" : undefined;
    },
    phase: () => phase,
    requestSync: (source) => {
      if (endWait !== undefined && endsWait(source)) {
        endWait();
        return;
      }
      if (
        pending === undefined ||
        REQUEST_RANK[source] > REQUEST_RANK[pending]
      ) {
        pending = source;
      }
    },
    run: async (signal) => {
      signal.addEventListener("abort", endWaitOnAbort, { once: true });
      try {
        while (!signal.aborted) {
          pending = undefined;
          caughtUpThisCycle = false;
          setPhase({ kind: "syncing" });
          // oxlint-disable-next-line eslint/no-await-in-loop -- One cycle at a time is the loop.
          const outcome = await cycle(signal);
          if (signal.aborted) {
            break;
          }
          const next = afterCycle(outcome);
          if (next.kind === "stopped") {
            break;
          }
          if (next.kind !== "syncing") {
            setPhase(next);
            // oxlint-disable-next-line eslint/no-await-in-loop -- The wait between cycles.
            await wait(next, signal);
          }
        }
      } finally {
        signal.removeEventListener("abort", endWaitOnAbort);
        setPhase({ kind: "stopped" });
      }
    },
  };
};
