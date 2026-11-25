import { Cause, Clock, Deferred, Effect, Exit, Result } from "effect";

/**
 * What one account's background loop is doing. `syncing` is the catch-up pass
 * that opens every cycle and `indexing` the skeleton and body work after it;
 * the other phases are waits, each with its own rule for what ends it.
 * `syncing` begins when the cycle does, so it also covers connecting.
 */
export type AccountWorkerPhase =
  | {
      readonly kind: "idle";
      /** When the poll is due. A loop waiting on the server ignores it. */
      readonly until: number;
    }
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
  /**
   * The server answers, and lists none of the mailboxes the account's mail
   * is read from: only a setting at the provider brings it back.
   */
  | { readonly kind: "mail-hidden" }
  | { readonly kind: "sign-in-refused" };

/**
 * Who asked for a sync. `automatic` covers focus, a send and a failed change;
 * it never retries a refused sign-in, which would repeat the refusal on every
 * focus. `user` is Sync now, and `account-connected` a sign-in just verified.
 */
export type SyncRequestSource = "account-connected" | "automatic" | "user";

/**
 * What a wait for the server's news came to. `sync` asks for a cycle;
 * `unavailable` means the server cannot be waited on, so the poll decides.
 */
export type AccountWatchOutcome = "sync" | "unavailable";

interface AccountWorkerOptions<R> {
  readonly onPhaseChange: (phase: AccountWorkerPhase) => void;
  /** Between cycles while the server is not being waited on. */
  readonly pollIntervalMs: number;
  readonly retryDelaysMs: readonly number[];
  /** One cycle. One that fails or dies counts as a failed cycle. */
  readonly runCycle: (cycle: {
    readonly syncPassEnded: (caughtUp: boolean) => void;
  }) => Effect.Effect<AccountCycleOutcome, unknown, R>;
  /**
   * Waits for the server to report news while the loop is idle. Completing
   * `stop` asks it to end and leave its connection usable; the loop waits
   * for that before its next cycle, which needs the same connection. A wait
   * that fails counts as `unavailable`. Interrupting the loop interrupts the
   * wait instead: the account is going away, and the wait may simply be
   * dropped with its connection.
   */
  readonly watch?: (
    stop: Deferred.Deferred<void>
  ) => Effect.Effect<AccountWatchOutcome, unknown, R>;
  /** Cycles the server's news asks for begin at least this far apart. */
  readonly watchSpacingMs?: number;
}

export interface AccountWorker<R = never> {
  /**
   * The index status this account's trouble overrides: `paused` while it
   * needs a new sign-in, `failed` while its server cannot be reached, and
   * `hidden` while the server keeps its mail from mail apps.
   */
  readonly indexStatus: () => "failed" | "hidden" | "paused" | undefined;
  readonly phase: () => AccountWorkerPhase;
  readonly requestSync: (source: SyncRequestSource) => void;
  /**
   * The loop itself. It ends when the account is gone, and interrupting it
   * stops it, whatever it is waiting for.
   */
  readonly run: Effect.Effect<void, never, R>;
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

  if (failure?._tag === "MailHiddenError") {
    return { kind: "mail-hidden" };
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
export const createAccountWorker = <R = never>({
  onPhaseChange,
  pollIntervalMs,
  retryDelaysMs,
  runCycle,
  watch,
  watchSpacingMs = 0,
}: AccountWorkerOptions<R>): AccountWorker<R> => {
  let phase: AccountWorkerPhase = { kind: "stopped" };
  let failures = 0;
  /** The strongest request that arrived since the running cycle began. */
  let pending: SyncRequestSource | undefined;
  // What keeps the account from catching up, kept apart from the phase: it
  // lasts through the retries and ends only when a catch-up pass works.
  // Every view of indexing reads anything but `running` as not indexing, so
  // trouble that cleared for each retry would blink them, and so would
  // reporting each passing failure: `unreachable` waits for the last step.
  let trouble: "hidden" | "sign-in" | "unreachable" | undefined;
  let caughtUpThisCycle = false;
  /** What ends the wait now running; a sync request completes it. */
  let waking: Deferred.Deferred<void> | undefined;
  let lastWatchedSyncAt = Number.NEGATIVE_INFINITY;

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

  const afterCycle = (
    outcome: AccountCycleOutcome,
    now: number
  ): Exclude<AccountWorkerPhase, { readonly kind: "indexing" }> => {
    if (outcome.kind === "account-missing") {
      return { kind: "stopped" };
    }

    if (outcome.kind === "done") {
      failures = 0;

      return outcome.moreWork || pending !== undefined
        ? { kind: "syncing" }
        : { kind: "idle", until: now + pollIntervalMs };
    }

    if (outcome.kind === "sign-in-refused") {
      trouble = "sign-in";

      return pending === undefined || pending === "automatic"
        ? { kind: "needs-sign-in" }
        : { kind: "syncing" };
    }

    failures += 1;

    if (outcome.kind === "mail-hidden") {
      // Known at once, and retried like any failure: the loop finds the mail
      // again by itself once the user has shown it. Never called unreachable
      // however long it lasts, which would send them to check a connection
      // that works.
      trouble = "hidden";
    } else if (!caughtUpThisCycle && failures >= retryDelaysMs.length) {
      trouble = "unreachable";
    }

    if (outcome.kind === "failed" && outcome.retryAfterMs !== undefined) {
      return {
        attempt: failures,
        kind: "retrying",
        serverDelay: true,
        until: now + outcome.retryAfterMs,
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
      until: now + delay,
    };
  };

  /**
   * Sleeps until `at`, unless a sync request ends the wait first. The time is
   * absolute, so the wait ends when its phase says it does however long the
   * steps before the sleep took.
   */
  const sleepUntil = Effect.fnUntraced(function* sleepUntil(
    at: number,
    wake: Deferred.Deferred<void>
  ) {
    const delay = at - (yield* Clock.currentTimeMillis);

    if (delay > 0) {
      yield* Deferred.await(wake).pipe(
        Effect.timeoutOrElse({ duration: delay, orElse: () => Effect.void })
      );
    }
  });

  /**
   * The wait between cycles, which `wake` ends: a sync request completes it.
   *
   * An idle loop waits on the server where it can: news ends the wait, and
   * the poll takes over only when the server cannot be waited on. A wait
   * that failed counts as that too, so a server that keeps failing it is
   * polled rather than hammered.
   *
   * `wake` is also what asks the server wait to stop. It is never raced
   * against that wait: losing a race would interrupt it and drop its
   * connection, when all a sync request needs is for it to finish.
   */
  const wait = Effect.fnUntraced(function* wait(
    waiting: Exclude<
      AccountWorkerPhase,
      { readonly kind: "indexing" | "stopped" | "syncing" }
    >,
    wake: Deferred.Deferred<void>
  ) {
    if (waiting.kind === "needs-sign-in") {
      yield* Deferred.await(wake);

      return;
    }

    if (waiting.kind === "retrying" || watch === undefined) {
      yield* sleepUntil(waiting.until, wake);

      return;
    }

    const watched = yield* Effect.exit(Effect.suspend(() => watch(wake)));

    if (yield* Deferred.isDone(wake)) {
      return;
    }

    if (Exit.isFailure(watched) || watched.value === "unavailable") {
      yield* sleepUntil(waiting.until, wake);

      return;
    }

    const startsAt = Math.max(
      yield* Clock.currentTimeMillis,
      lastWatchedSyncAt + watchSpacingMs
    );

    lastWatchedSyncAt = startsAt;
    yield* sleepUntil(startsAt, wake);
  });

  const cycle = Effect.suspend(() =>
    runCycle({
      syncPassEnded: (caughtUp) => {
        if (!caughtUp || phase.kind !== "syncing") {
          return;
        }

        caughtUpThisCycle = true;
        trouble = undefined;
        setPhase({ kind: "indexing" });
      },
    })
  ).pipe(
    Effect.exit,
    Effect.map((exit): AccountCycleOutcome =>
      Exit.isSuccess(exit) ? exit.value : { kind: "failed" }
    )
  );

  const waitEnded = Effect.sync(() => {
    waking = undefined;
  });

  const run = Effect.gen(function* runLoop() {
    for (;;) {
      pending = undefined;
      caughtUpThisCycle = false;
      setPhase({ kind: "syncing" });
      const outcome = yield* cycle;
      const now = yield* Clock.currentTimeMillis;

      // Nothing yields from here until the wait can be ended. A request in
      // that gap would be too late to count as pending and too early to end
      // the wait, and would be lost.
      const next = afterCycle(outcome, now);

      if (next.kind === "stopped") {
        return;
      }

      if (next.kind !== "syncing") {
        setPhase(next);
        const wake: Deferred.Deferred<void> = Deferred.makeUnsafe();
        waking = wake;
        yield* wait(next, wake).pipe(Effect.ensuring(waitEnded));
      }
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        setPhase({ kind: "stopped" });
      })
    )
  );

  return {
    indexStatus: () => {
      if (trouble === "sign-in") {
        return "paused";
      }

      if (trouble === "hidden") {
        return "hidden";
      }

      return trouble === "unreachable" ? "failed" : undefined;
    },
    phase: () => phase,
    requestSync: (source) => {
      if (waking !== undefined && endsWait(source)) {
        Deferred.doneUnsafe(waking, Effect.void);

        return;
      }

      if (
        pending === undefined ||
        REQUEST_RANK[source] > REQUEST_RANK[pending]
      ) {
        pending = source;
      }
    },
    run,
  };
};
