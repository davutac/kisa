import { Clock, Deferred, Effect } from "effect";

import type { MailStoreError, MailTransportError } from "./errors";
import type { MailboxState, WatchOutcome } from "./session";
import { MailEngineStore } from "./store";
import type { MailboxRecord, ThreadChanges } from "./store";
import { NO_THREAD_CHANGES, syncMailbox, toImapMailbox } from "./sync";
import type { SyncScope } from "./sync";

/**
 * How a wait for a mailbox's news ended.
 *
 * - `ahead`: mail the last pass did not cache is already on the server, so
 *   nothing was waited for.
 * - `arrived`: mail arrived during the wait.
 * - `quiet`: the wait ran its length, or was asked to stop.
 * - `unavailable`: this mailbox cannot be waited on (no IDLE, or no such
 *   mailbox).
 */
export type MailboxWatchOutcome = "ahead" | "arrived" | "quiet" | "unavailable";

/** One mailbox an account waits on, and what its news is about. */
export interface WatchTarget {
  /**
   * What mail arriving here does. `pass` ends the wait so the caller runs a
   * pass, which also fetches the mail's text. `refresh` caches it in place
   * like any other change, and the wait goes on.
   */
  readonly arrivals: "pass" | "refresh";
  /**
   * The synced mailbox the reports are about: the watched one, or All Mail
   * for Gmail's Inbox, which the dialect does not sync by itself.
   */
  readonly cachedPath?: string | undefined;
  /** The mailbox the connection waits in. */
  readonly path: string;
}

export interface WatchTargets {
  /** A second mailbox waited on beside the Inbox, on its own connection. */
  readonly extra?: WatchTarget | undefined;
  readonly primary: WatchTarget;
}

/**
 * Which mailboxes an account waits on. `IDLE` reports on one mailbox per
 * connection, so this is the Inbox and at most one more:
 *
 * - Where the Inbox is synced (every provider but Gmail), Sent beside it, so
 *   mail sent from another device shows when it is sent.
 * - On Gmail, where the dialect syncs All Mail, All Mail beside the Inbox.
 *   All Mail sees every arrival and every flag change in the account; the
 *   Inbox sees mail leaving it, which in All Mail is only a label changing.
 *
 * Only the Inbox's arrivals start a pass. What arrives in the other mailbox
 * is cached in place: Kisa's own sent copies land there, and so does every
 * save of a draft being written on another device.
 */
export const watchTargets = (
  mailboxes: readonly MailboxRecord[]
): WatchTargets | undefined => {
  const inbox = mailboxes.find(
    (mailbox) => mailbox.role === "inbox" && mailbox.selectable
  );
  if (inbox === undefined) {
    return undefined;
  }
  const synced = (role: MailboxRecord["role"]): MailboxRecord | undefined =>
    mailboxes.find(
      (mailbox) => mailbox.role === role && mailbox.synced && mailbox.selectable
    );

  if (inbox.synced) {
    const sent = synced("sent");
    return {
      extra:
        sent === undefined
          ? undefined
          : { arrivals: "refresh", cachedPath: sent.path, path: sent.path },
      primary: { arrivals: "pass", cachedPath: inbox.path, path: inbox.path },
    };
  }

  const all = synced("all");
  return {
    extra:
      all === undefined
        ? undefined
        : { arrivals: "refresh", cachedPath: all.path, path: all.path },
    primary: { arrivals: "pass", cachedPath: all?.path, path: inbox.path },
  };
};

export interface MailboxWatchOptions<R = never> {
  /**
   * Compare the server with the cache before the first wait. Left out right
   * after that comparison started a pass, so a server whose answers never
   * settle gets one pass and then a real wait.
   */
  readonly compare: boolean;
  readonly maxMs: number;
  /**
   * Told what a refresh changed in the cache, so the caller can show it. A
   * refresh follows a report that mail left the mailbox or a flag changed.
   */
  readonly refreshed: (changes: ThreadChanges) => Effect.Effect<void, never, R>;
  /** Refreshes begin at least this far apart, however often the server reports. */
  readonly refreshSpacingMs: number;
  /** Completed to end the wait, leaving the connection ready for a pass. */
  readonly stop: Deferred.Deferred<void>;
}

const hasNewMail = (state: MailboxState, cached: MailboxRecord): boolean =>
  state.uidValidity !== cached.uidValidity || state.uidNext !== cached.uidNext;

/**
 * Brings one mailbox's cached copies up to date, the way a pass does for
 * each mailbox in turn. Without mod-sequences only the newest copies' flags
 * are read again: what a server reports as changed is nearly always recent.
 */
const refreshMailbox = Effect.fn("MailWatch.refreshMailbox")(
  function* refreshMailbox(scope: SyncScope, path: string) {
    const store = yield* MailEngineStore;
    const cached = (yield* store.getMailboxes(scope.accountId)).find(
      (mailbox) => mailbox.path === path
    );

    return cached === undefined
      ? NO_THREAD_CHANGES
      : yield* syncMailbox(scope, toImapMailbox(cached), cached, {
          rereadFlags: "newest",
        });
  }
);

/**
 * What a report means for a target: an outcome that ends its wait, or a
 * refresh of its cache. `ahead` is the report that mail the cache lacks is
 * on the server already.
 */
const answerTo = (
  target: WatchTarget,
  report: "ahead" | WatchOutcome,
  hasCache: boolean
): MailboxWatchOutcome | "refresh" => {
  if (report === "quiet") {
    return "quiet";
  }
  if (target.arrivals === "pass" && report !== "changed") {
    return report;
  }
  if (hasCache) {
    return "refresh";
  }
  // Nothing here to refresh: a pass reads the account instead.
  return target.arrivals === "pass" ? "arrived" : "unavailable";
};

/**
 * Waits out what is left of the spacing between refreshes. `false` when the
 * wait was asked to stop meanwhile.
 */
const paceRefresh = Effect.fnUntraced(function* paceRefresh(
  refreshedAt: number,
  spacingMs: number,
  stop: Deferred.Deferred<void>
) {
  const pause = refreshedAt + spacingMs - (yield* Clock.currentTimeMillis);
  if (pause > 0) {
    yield* Deferred.await(stop).pipe(
      Effect.timeoutOrElse({ duration: pause, orElse: () => Effect.void })
    );
  }
  return !(yield* Deferred.isDone(stop));
});

/**
 * Waits for the server to report on one mailbox, so what happens there
 * reaches the cache when it happens rather than at the next pass.
 *
 * - Mail arriving ends the wait where the target says so: the caller runs a
 *   pass, which also fetches the new mail's text.
 * - Everything else (mail leaving, flags changing: read elsewhere, archived
 *   on a phone) is answered here with a refresh of that one mailbox, and the
 *   wait goes on. A server reports Kisa's own changes on its other
 *   connection the same way; those are already cached, so their refresh
 *   writes nothing. It takes the cache's turn first, so it never reads the
 *   cache halfway through such a change.
 *
 * A pass or refresh reads the server and the wait begins a moment later;
 * mail that lands in between is reported by neither. So each wait first
 * compares the server with the cache.
 */
export const watchForNews = Effect.fn("MailWatch.watchForNews")(
  function* watchForNews<R>(
    scope: SyncScope,
    target: WatchTarget,
    options: MailboxWatchOptions<R>
  ): Effect.fn.Return<
    MailboxWatchOutcome,
    MailStoreError | MailTransportError,
    MailEngineStore | R
  > {
    const { session } = scope;
    if (!session.capabilities.has("IDLE")) {
      return "unavailable";
    }

    const store = yield* MailEngineStore;
    const exclusive =
      scope.exclusive ??
      (<A, E, R2>(effect: Effect.Effect<A, E, R2>) => effect);
    const deadline = (yield* Clock.currentTimeMillis) + options.maxMs;
    let { compare } = options;
    let refreshedAt = Number.NEGATIVE_INFINITY;

    for (;;) {
      const mailboxes = yield* store.getMailboxes(scope.accountId);
      const watched = mailboxes.find(
        (mailbox) => mailbox.path === target.path && mailbox.selectable
      );
      if (watched === undefined) {
        return "unavailable";
      }
      const cached = mailboxes.find(
        (mailbox) => mailbox.path === target.cachedPath && mailbox.synced
      );

      const remaining = deadline - (yield* Clock.currentTimeMillis);
      if (remaining <= 0 || (yield* Deferred.isDone(options.stop))) {
        return "quiet";
      }
      const isAhead =
        compare &&
        cached !== undefined &&
        hasNewMail(yield* session.status(cached.path), cached);
      compare = true;

      const report = isAhead
        ? "ahead"
        : yield* session.watch(watched.path, {
            maxMs: remaining,
            stop: options.stop,
          });
      const answer = answerTo(target, report, cached !== undefined);
      if (answer !== "refresh" || cached === undefined) {
        return answer === "refresh" ? "unavailable" : answer;
      }
      if (
        !(yield* paceRefresh(
          refreshedAt,
          options.refreshSpacingMs,
          options.stop
        ))
      ) {
        return "quiet";
      }

      const changes = yield* exclusive(refreshMailbox(scope, cached.path));
      refreshedAt = yield* Clock.currentTimeMillis;
      yield* options.refreshed(changes);
      if (target.arrivals === "pass" && (changes.arrived?.length ?? 0) > 0) {
        // The refresh was the first to see new mail, and cached it.
        return "arrived";
      }
    }
  }
);

/**
 * Runs the Inbox's wait with the waits beside it. The Inbox's wait decides
 * everything: its outcome is the outcome, and its failure the failure, so an
 * account whose extra wait cannot run behaves exactly as if it had none.
 *
 * The extra waits live as long as the Inbox's. When it ends they are asked to
 * stop, never raced: losing a race would interrupt them and drop their
 * connection, when all the next pass needs is for them to finish. One that
 * fails or cannot run ends alone and is tried again at the next wait.
 */
export const watchTogether = Effect.fn("MailWatch.watchTogether")(
  function* watchTogether<A, E, R, E2, R2>(
    primary: (stop: Deferred.Deferred<void>) => Effect.Effect<A, E, R>,
    extras: readonly ((
      stop: Deferred.Deferred<void>
    ) => Effect.Effect<unknown, E2, R2>)[],
    stop: Deferred.Deferred<void>
  ) {
    const halt: Deferred.Deferred<void> = Deferred.makeUnsafe();
    const halted = Deferred.succeed(halt, undefined);

    const [ended] = yield* Effect.all(
      [
        // Not when interrupted: then every wait is dropped, none asked.
        Effect.exit(primary(halt)).pipe(Effect.tap(halted)),
        Effect.forEach(extras, (extra) => Effect.exit(extra(halt)), {
          concurrency: "unbounded",
          discard: true,
        }),
      ],
      { concurrency: "unbounded" }
    ).pipe(
      Effect.raceFirst(
        Deferred.await(stop).pipe(
          Effect.andThen(halted),
          Effect.andThen(Effect.never)
        )
      )
    );

    return yield* ended;
  }
);
