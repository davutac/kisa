import type { MailTransportError } from "@repo/mail/errors";
import type { ImapAuth, ImapSession } from "@repo/mail/session";
import { ImapConnector } from "@repo/mail/session";
import type { MailAccount } from "@repo/mail/store";
import { Cause, Effect, Exit, Predicate, Scope, Semaphore } from "effect";

import { forgetAccountSignIn, resolveImapAuth } from "./account-credentials";

/**
 * Each account keeps at most one connection per lane, so background sync
 * never queues a thread the user opened behind a long fetch. The `watch`
 * lane only ever waits for a second mailbox's news beside the background
 * lane's wait; no pass or change runs on it.
 */
const SESSION_LANES = ["background", "foreground", "watch"] as const;
export type SessionLane = (typeof SESSION_LANES)[number];

/** An unused connection is closed after this long. */
const IDLE_CLOSE_MS = 2 * 60_000;

interface OpenSession {
  readonly scope: Scope.Closeable;
  readonly session: ImapSession;
}

interface LanePool {
  current?: OpenSession | undefined;
  idleTimer?: ReturnType<typeof setTimeout> | undefined;
  readonly semaphore: Semaphore.Semaphore;
}

const pools = new Map<string, LanePool>();

const poolKey = (accountId: string, lane: SessionLane): string =>
  `${lane}\u0000${accountId}`;

const poolFor = (accountId: string, lane: SessionLane): LanePool => {
  const key = poolKey(accountId, lane);
  const existing = pools.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const created: LanePool = { semaphore: Semaphore.makeUnsafe(1) };
  pools.set(key, created);
  return created;
};

const closeSession = (open: OpenSession): Effect.Effect<void> =>
  Scope.close(open.scope, Exit.void);

const detach = (pool: LanePool): OpenSession | undefined => {
  clearTimeout(pool.idleTimer);
  pool.idleTimer = undefined;
  const { current } = pool;
  pool.current = undefined;
  return current;
};

/** One sign-in attempt. A refused sign-in is forgotten, not offered again. */
const connect = Effect.fn("MailSessions.connect")(function* connect(
  account: MailAccount,
  auth: ImapAuth
) {
  const connector = yield* ImapConnector;
  const scope = yield* Scope.make();
  const session = yield* Scope.provide(scope)(
    connector.connect({
      accountId: account.accountId,
      auth,
      server: account.imap,
    })
  ).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        if (error._tag === "MailAuthError") {
          forgetAccountSignIn(account.accountId);
        }
      })
    ),
    Effect.onError(() => Scope.close(scope, Exit.void))
  );

  return { scope, session } satisfies OpenSession;
});

/**
 * Opens a connection with the account's sign-in. An access token can stop
 * working before its time, so one a server refuses is renewed and tried once
 * more: only a refused renewal, or a refused fresh token, is the account
 * itself being turned away, which ends its background work until the user
 * signs in again. A refused password is that at once.
 */
const openSession = Effect.fn("MailSessions.open")(function* openSession(
  account: MailAccount
) {
  const auth = yield* resolveImapAuth(account);

  return yield* connect(account, auth).pipe(
    Effect.catchIf(
      (error) => error._tag === "MailAuthError" && auth.kind === "oauth",
      () =>
        resolveImapAuth(account).pipe(
          Effect.flatMap((renewed) => connect(account, renewed))
        )
    )
  );
});

const SESSION_ENDING_ERRORS = [
  "MailAuthError",
  "MailConnectionError",
  "MailThrottledError",
] as const;

/**
 * A failure that leaves the connection's state unknown or unusable. The next
 * use opens a new one, which also picks up a refreshed token.
 */
const shouldDropSession = <E>(cause: Cause.Cause<E>): boolean =>
  Cause.hasInterrupts(cause) ||
  Cause.hasDies(cause) ||
  cause.reasons.some(
    (reason) =>
      Cause.isFailReason(reason) &&
      SESSION_ENDING_ERRORS.some((tag) => Predicate.isTagged(reason.error, tag))
  );

/**
 * Runs `use` with the account's connection for `lane`, opening one when
 * needed. Calls on one lane run one at a time; IMAP serializes them anyway.
 */
export const withAccountSession = <A, E, R>(
  account: MailAccount,
  lane: SessionLane,
  use: (session: ImapSession) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | MailTransportError, R | ImapConnector> => {
  const pool = poolFor(account.accountId, lane);

  return pool.semaphore.withPermit(
    Effect.gen(function* useAccountSession() {
      clearTimeout(pool.idleTimer);
      pool.idleTimer = undefined;
      const open = pool.current ?? (yield* openSession(account));
      pool.current = open;

      const exit = yield* Effect.exit(use(open.session));
      const context = yield* Effect.context();

      if (Exit.isFailure(exit) && shouldDropSession(exit.cause)) {
        detach(pool);
        yield* closeSession(open);
      } else {
        pool.idleTimer = setTimeout(() => {
          const idle = detach(pool);
          if (idle !== undefined) {
            void Effect.runPromiseWith(context)(closeSession(idle));
          }
        }, IDLE_CLOSE_MS);
      }

      return yield* exit;
    })
  );
};

/**
 * Closes an account's connections, for disconnect and quit. Each close says
 * goodbye to its server, so they run together rather than one round trip
 * after another.
 */
export const closeAccountSessions = (accountId: string): Effect.Effect<void> =>
  Effect.forEach(
    SESSION_LANES,
    (lane) => {
      const key = poolKey(accountId, lane);
      const pool = pools.get(key);
      pools.delete(key);
      const open = pool === undefined ? undefined : detach(pool);
      return open === undefined ? Effect.void : closeSession(open);
    },
    { concurrency: "unbounded", discard: true }
  );

export const closeAllSessions: Effect.Effect<void> = Effect.suspend(() =>
  Effect.forEach(
    [...new Set([...pools.keys()].map((key) => key.split("\u0000")[1] ?? ""))],
    closeAccountSessions,
    { concurrency: "unbounded", discard: true }
  )
);
