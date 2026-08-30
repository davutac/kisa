import { setTimeout as delay } from "node:timers/promises";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import {
  gmailBackfillState,
  gmailMessages,
  gmailThreads,
} from "@repo/database/schemas";
import type { GmailBackfillStatus } from "@repo/database/schemas";
import type { GmailError } from "@repo/gmail/errors";
import { GmailGateway } from "@repo/gmail/gateway";
import type { GmailMime } from "@repo/gmail/mime";
import type { PageCursor, ThreadPage } from "@repo/gmail/models";
import { AccountId, isGmailScope } from "@repo/gmail/models";
import { Gmail } from "@repo/gmail/service";
import { GmailStore } from "@repo/gmail/store";
import { count, eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

import { MAIL_INDEX_PROGRESS_CHANNEL } from "../../shared/ipc/channels";
import { GmailIndexProgressList } from "../../shared/ipc/mail";
import type {
  GmailIndexProgress,
  GmailIndexStatus,
} from "../../shared/ipc/mail";
import { setNativeMailIndexProgress } from "../app/native-mail-index-progress";
import { onGoogleAccountConnected } from "../auth/account-events";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";
import { accountMailWorkSupervisor } from "./account-mail-work-supervisor";
import { GmailGatewayLive } from "./gmail-gateway";
import { GmailMimeLive } from "./gmail-mime";
import { GmailStoreLive } from "./gmail-store";
import { mergeWatermark, oldestTimestamp } from "./mail-backfill-cursor";
import { resetMailIndexRemote } from "./mail-index-reindex";
import {
  MAIL_INDEX_PAGE_SIZE,
  toMailIndexPageRequest,
} from "./mail-index-request";
import { mailQuotaGovernor, QUOTA_UNITS } from "./quota-governor";
import { refreshUnreadBadge } from "./unread-badge";

/** One page's worth of quota: the list call plus a `threads.get` per thread. */
const PAGE_QUOTA_UNITS =
  QUOTA_UNITS.threadsList + MAIL_INDEX_PAGE_SIZE * QUOTA_UNITS.threadsGet;

/**
 * How many accounts index at once.
 *
 * Not one. Gmail's rate limit is per *user*, and every call is made with that
 * account's own credentials, so two accounts draw on two independent budgets —
 * the governor already keys its buckets by account id. Serialising them buys no
 * quota headroom and makes the second mailbox wait out the whole of the first.
 *
 * The cap exists for the resources accounts genuinely share: sustained
 * bandwidth (~750 KB/s per indexer) and the synchronous main-thread SQLite
 * writes. Two is enough to cover the common multi-account case without letting
 * a five-account setup saturate either.
 */
const MAX_CONCURRENT_BACKFILLS = 2;

const PROGRESS_THROTTLE_MS = 1000;
const MAX_PAGE_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2000;

// oxlint-disable-next-line unicorn/throw-new-error
class MailBackfillError extends Schema.TaggedError<MailBackfillError>()(
  "MailBackfillError",
  { message: Schema.String }
) {}

const GmailLive = Gmail.layerWithoutDependencies.pipe(
  Layer.provideMerge(
    Layer.mergeAll(GmailStoreLive, GmailGatewayLive, GmailMimeLive)
  )
);

type GmailServices = Gmail | GmailGateway | GmailMime | GmailStore;

const runGmail = <A, E extends GmailError>(
  effect: Effect.Effect<A, E, GmailServices>
): Effect.Effect<A, E> => effect.pipe(Effect.provide(GmailLive));

const backfillError = (message: string) => new MailBackfillError({ message });

const withDatabase = <A>(
  message: string,
  run: (database: RemoteDatabaseClient) => Promise<A>
) =>
  withDatabaseClient(run).pipe(Effect.mapError(() => backfillError(message)));

interface BackfillState {
  readonly estimatedThreads: number | null;
  readonly indexedMessages: number;
  readonly indexedThreads: number;
  readonly lastError: string | null;
  readonly oldestIndexedAt: number | null;
  /** The renderer-facing union: a superset of the persisted statuses. */
  readonly status: GmailIndexStatus;
}

const readState = (accountId: string) =>
  withDatabase("Could not read the mail index state", (database) =>
    database.query.gmailBackfillState.findFirst({
      where: { accountEmail: accountId },
    })
  );

interface StatePatch {
  readonly completedAt?: number;
  readonly estimatedThreads?: number;
  readonly lastError?: string | null;
  readonly oldestIndexedAt?: number;
  readonly pageToken?: string | null;
  readonly startedAt?: number;
  readonly status?: GmailBackfillStatus;
}

const writeState = (accountId: string, patch: StatePatch) =>
  withDatabase("Could not save the mail index state", async (database) => {
    const values = {
      accountEmail: accountId,
      status: "idle" as GmailBackfillStatus,
      updatedAt: Date.now(),
      ...patch,
    };

    await database
      .insert(gmailBackfillState)
      .values(values)
      .onConflictDoUpdate({
        set: { ...patch, updatedAt: values.updatedAt },
        target: gmailBackfillState.accountEmail,
      })
      .run();
  });

/**
 * Counters are read back from the indexed rows rather than accumulated across
 * pages. A resume re-walks up to a day of overlap by design, so an accumulator
 * would drift upward on every restart and could report more threads indexed
 * than the mailbox contains.
 */
const readCounts = (accountId: string) =>
  withDatabase("Could not read the mail index counts", async (database) => {
    const messageRows = await database
      .select({ value: count() })
      .from(gmailMessages)
      .where(eq(gmailMessages.accountEmail, accountId))
      .all();
    const threadRows = await database
      .select({ value: count() })
      .from(gmailThreads)
      .where(eq(gmailThreads.accountEmail, accountId))
      .all();

    return {
      messages: messageRows.at(0)?.value ?? 0,
      threads: threadRows.at(0)?.value ?? 0,
    };
  });

const toProgress = (
  accountId: string,
  state: BackfillState
): GmailIndexProgress => ({
  accountId,
  error: state.lastError ?? undefined,
  estimatedThreads: state.estimatedThreads ?? undefined,
  indexedMessages: state.indexedMessages,
  indexedThreads: state.indexedThreads,
  oldestIndexedAt: state.oldestIndexedAt ?? undefined,
  status: state.status,
});

const progressByAccount = new Map<string, GmailIndexProgress>();
let lastProgressSentAt = 0;
let pendingProgressTimer: ReturnType<typeof setTimeout> | undefined;

const sendProgress = (): void => {
  lastProgressSentAt = Date.now();
  setNativeMailIndexProgress([...progressByAccount.values()]);
  sendRendererEvent(MAIL_INDEX_PROGRESS_CHANNEL, GmailIndexProgressList, {
    accounts: [...progressByAccount.values()],
  });
};

/**
 * Throttled because a page completes every few seconds and the renderer redraws
 * on each update; a terminal state always flushes immediately so the spinner
 * cannot be left running after the work stopped.
 */
const publishProgress = (progress: GmailIndexProgress): void => {
  progressByAccount.set(progress.accountId, progress);

  const isSettled = progress.status !== "running";
  const elapsed = Date.now() - lastProgressSentAt;

  if (isSettled || elapsed >= PROGRESS_THROTTLE_MS) {
    if (pendingProgressTimer !== undefined) {
      clearTimeout(pendingProgressTimer);
      pendingProgressTimer = undefined;
    }

    sendProgress();
    return;
  }

  if (pendingProgressTimer === undefined) {
    pendingProgressTimer = setTimeout(() => {
      pendingProgressTimer = undefined;
      sendProgress();
    }, PROGRESS_THROTTLE_MS - elapsed);
    pendingProgressTimer.unref();
  }
};

const refreshProgress = Effect.fn("mailBackfill.refreshProgress")(
  function* refreshProgress(accountId: string, status: GmailIndexStatus) {
    const row = yield* readState(accountId);
    const counts = yield* readCounts(accountId);

    publishProgress(
      toProgress(accountId, {
        estimatedThreads: row?.estimatedThreads ?? null,
        indexedMessages: counts.messages,
        indexedThreads: counts.threads,
        lastError: row?.lastError ?? null,
        oldestIndexedAt: row?.oldestIndexedAt ?? null,
        status,
      })
    );
  }
);

export const getMailIndexProgress = (): GmailIndexProgress[] => [
  ...progressByAccount.values(),
];

const listPage = (
  accountId: AccountId,
  cursor: PageCursor | undefined,
  oldestIndexedAt: number | null
) =>
  runGmail(
    Gmail.pipe(
      Effect.flatMap((gmail) =>
        gmail.listThreads(
          toMailIndexPageRequest(accountId, cursor, oldestIndexedAt)
        )
      )
    )
  );

const estimateThreadTotal = Effect.fn("mailBackfill.estimateThreadTotal")(
  function* estimateThreadTotal(accountId: AccountId) {
    const totals = yield* runGmail(
      Effect.gen(function* readTotals() {
        const store = yield* GmailStore;
        const gateway = yield* GmailGateway;
        const authorization = yield* store.getAuthorization(accountId);

        if (authorization._tag === "None") {
          return null;
        }

        const result = yield* gateway.getMailboxTotals(authorization.value);

        return result.value;
      })
    ).pipe(Effect.orElseSucceed(() => null));

    // A missing or zero total is not fatal — the indicator falls back to an
    // indeterminate ring rather than the run refusing to start.
    if (totals !== null && totals.threadsTotal > 0) {
      yield* writeState(accountId, {
        estimatedThreads: totals.threadsTotal,
      }).pipe(Effect.ignore);
    }
  }
);

const cancellations = new Set<string>();
const queued: string[] = [];
const active = new Set<string>();
const pendingReindexes = new Set<string>();

const isMailIndexScheduled = (accountId: string): boolean =>
  active.has(accountId) ||
  queued.includes(accountId) ||
  pendingReindexes.has(accountId);

const ensureMailIndexCanStart = (accountId: string) => {
  if (isMailIndexScheduled(accountId)) {
    return Effect.fail(backfillError("Mail is already being indexed"));
  }

  return accountMailWorkSupervisor.isSuspended(accountId)
    ? Effect.fail(backfillError("The Gmail account is not available"))
    : Effect.void;
};

const isCancelled = (accountId: string): boolean =>
  cancellations.has(accountId);

const oldestOf = (page: ThreadPage): number | null =>
  oldestTimestamp(page.items.map((thread) => Number(thread.latestAt)));

const isReauthorizationError = (error: GmailError): boolean =>
  error._tag === "GmailReauthorizationRequiredError";

const isRetryableError = (error: GmailError): boolean =>
  error._tag === "GmailRateLimitError" ||
  (error._tag === "GmailApiError" && error.retryable);

type PageOutcome =
  | {
      readonly cursor?: PageCursor;
      readonly oldest: number | null;
      readonly type: "page";
    }
  | { readonly error: GmailError; readonly type: "failed" };

/**
 * One page, with its own retry budget. A rate limit is not a failure here — the
 * governor has already slowed the account down, so the page waits and tries
 * again rather than ending the run.
 *
 * Failures come back as a value rather than a rejection: an Effect run through
 * `runPromise` rejects with a wrapped cause whose shape is not part of the
 * contract, and branching on reauthorization-versus-retryable needs the actual
 * typed error.
 */
const runPage = async (
  accountId: AccountId,
  cursor: PageCursor | undefined,
  oldestIndexedAt: number | null
): Promise<PageOutcome> => {
  let attempt = 0;

  for (;;) {
    attempt += 1;

    // oxlint-disable-next-line eslint/no-await-in-loop
    await mailQuotaGovernor.awaitBudget(accountId, PAGE_QUOTA_UNITS);

    // oxlint-disable-next-line eslint/no-await-in-loop
    const result = await Effect.runPromise(
      listPage(accountId, cursor, oldestIndexedAt).pipe(
        Effect.map(
          (page) =>
            ({
              cursor: page.nextCursor,
              oldest: oldestOf(page),
              type: "page",
            }) as PageOutcome
        ),
        Effect.catch((error) =>
          Effect.succeed({ error, type: "failed" } as PageOutcome)
        )
      )
    );

    if (
      result.type === "page" ||
      isReauthorizationError(result.error) ||
      !isRetryableError(result.error) ||
      attempt >= MAX_PAGE_ATTEMPTS
    ) {
      return result;
    }

    // oxlint-disable-next-line eslint/no-await-in-loop
    await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  }
};

/**
 * Walks an account's mailbox newest-first, which is the same direction the user
 * scrolls, so the list deepens ahead of them rather than filling in behind.
 *
 * The cursor is two-level on purpose: `page.nextCursor` is exact and used for
 * as long as this run lasts, while `oldest_indexed_at` is written every page as
 * the durable restart point. Both advance inside the page's own transaction, so
 * an interrupted run can only ever replay a page, never skip one.
 */
const settle = async (
  accountId: string,
  status: GmailBackfillStatus,
  patch: StatePatch
): Promise<void> => {
  await Effect.runPromise(
    writeState(accountId, { ...patch, status }).pipe(
      Effect.andThen(refreshProgress(accountId, status)),
      Effect.andThen(refreshUnreadBadge()),
      Effect.ignore
    )
  );
};

const runBackfill = async (accountId: string): Promise<void> => {
  const account = AccountId.make(accountId);
  const initial = await Effect.runPromise(
    readState(accountId).pipe(Effect.orElseSucceed(() => null))
  );

  if (initial?.status === "complete") {
    return;
  }

  await settle(accountId, "running", {
    lastError: null,
    startedAt: initial?.startedAt ?? Date.now(),
  });

  if ((initial?.estimatedThreads ?? null) === null) {
    await Effect.runPromise(estimateThreadTotal(account).pipe(Effect.ignore));
  }

  let cursor: PageCursor | undefined;
  let oldestIndexedAt = initial?.oldestIndexedAt ?? null;

  for (;;) {
    if (isCancelled(accountId)) {
      return;
    }

    // oxlint-disable-next-line eslint/no-await-in-loop
    const outcome = await runPage(account, cursor, oldestIndexedAt);

    if (outcome.type === "failed") {
      // Logged, not just recorded: a run that dies on its first page otherwise
      // leaves only a status in the database, and the actual Gmail error — the
      // one thing that says *why* — is never seen.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await Effect.runPromise(
        Effect.logWarning(
          `Mail index stopped for ${accountId}: ${outcome.error._tag} — ${outcome.error.message}`
        )
      );

      // A revoked or expired grant is not a failure of the index — it pauses,
      // and resumes once the account is connected again.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await settle(
        accountId,
        isReauthorizationError(outcome.error) ? "paused" : "failed",
        { lastError: outcome.error.message }
      );
      return;
    }

    oldestIndexedAt = mergeWatermark(oldestIndexedAt, outcome.oldest);
    ({ cursor } = outcome);

    const isDone = cursor === undefined;

    // oxlint-disable-next-line eslint/no-await-in-loop
    await settle(accountId, isDone ? "complete" : "running", {
      completedAt: isDone ? Date.now() : undefined,
      oldestIndexedAt: oldestIndexedAt ?? undefined,
      pageToken: cursor ?? null,
    });

    if (isDone) {
      return;
    }
  }
};

/**
 * Runs up to `MAX_CONCURRENT_BACKFILLS` accounts at once; the rest wait in a
 * FIFO queue and start as slots free up.
 */
const drainQueue = (): void => {
  while (active.size < MAX_CONCURRENT_BACKFILLS) {
    const next = queued.shift();

    if (next === undefined) {
      return;
    }

    if (isCancelled(next)) {
      cancellations.delete(next);
      continue;
    }

    active.add(next);

    // Not awaited: the loop keeps filling the remaining slots. Each run frees
    // its own slot and re-drains when it settles, so a finished account is
    // replaced immediately rather than waiting for something else to poke the
    // queue.
    const runQueuedBackfill = async (): Promise<void> => {
      try {
        await accountMailWorkSupervisor.run(next, async (signal) => {
          const cancel = (): void => {
            cancellations.add(next);
          };
          signal.addEventListener("abort", cancel, { once: true });
          if (signal.aborted) {
            cancel();
          }

          try {
            await runBackfill(next);
          } catch {
            // `runBackfill` records its own terminal state; a throw here must not
            // take the rest of the queue down with it.
          } finally {
            signal.removeEventListener("abort", cancel);
          }
        });
      } finally {
        active.delete(next);
        cancellations.delete(next);
        drainQueue();
      }
    };

    void runQueuedBackfill();
  }
};

export const requestMailBackfill = (accountId: string): void => {
  if (
    accountMailWorkSupervisor.isSuspended(accountId) ||
    isMailIndexScheduled(accountId)
  ) {
    return;
  }

  cancellations.delete(accountId);
  queued.push(accountId);
  drainQueue();

  // Still queued means every slot was taken. Publish that, or an account
  // waiting its turn would show no indicator at all and read as broken.
  if (queued.includes(accountId)) {
    void Effect.runPromise(
      refreshProgress(accountId, "queued").pipe(Effect.ignore)
    );
  }
};

/** Disconnect path: stop the run before `clearAccount` deletes its rows. */
export const cancelMailBackfill = (accountId: string): void => {
  cancellations.add(accountId);
  for (let index = queued.length - 1; index >= 0; index -= 1) {
    if (queued[index] === accountId) {
      queued.splice(index, 1);
    }
  }
  progressByAccount.delete(accountId);
  sendProgress();
};

const hasReadScope = (scopes: string): boolean => {
  try {
    const granted: unknown = JSON.parse(scopes);

    return Array.isArray(granted) && granted.some(isGmailScope);
  } catch {
    return false;
  }
};

const NO_ACCOUNT_IDS: readonly string[] = [];

const listReadableAccountIds = () =>
  withDatabase("Could not load Google accounts", async (database) => {
    const rows = await database.query.googleAccounts.findMany({
      columns: { email: true, scopes: true },
    });
    return rows
      .filter(({ scopes }) => hasReadScope(scopes))
      .map(({ email }) => email);
  });

/**
 * Explicit Settings action. It preserves the cache, clears only the durable
 * index checkpoint, and then lets the normal resumable indexer refresh every
 * conversation for this account.
 */
export const reindexMailAccount = Effect.fn("reindexMailAccount")(
  function* reindexMailAccount(accountId: string) {
    yield* ensureMailIndexCanStart(accountId);

    const readableAccountIds = yield* listReadableAccountIds();
    if (!readableAccountIds.includes(accountId)) {
      return yield* backfillError("The Gmail account is not available");
    }

    // Recheck after the database round trip so a concurrent connect or reindex
    // cannot reset a run that started while account access was being verified.
    yield* ensureMailIndexCanStart(accountId);

    // Prevent a reconnect event from starting the old completed run while its
    // checkpoint is being cleared in the database process.
    pendingReindexes.add(accountId);

    yield* withDatabase("Could not reset the mail index", (database) =>
      resetMailIndexRemote(database, accountId)
    ).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          pendingReindexes.delete(accountId);
        })
      )
    );
    yield* Effect.sync(() => requestMailBackfill(accountId));
  }
);

/**
 * Seeds the renderer's progress state and decides what to index on launch.
 *
 * This walks *connected accounts*, not just existing state rows. An account
 * connected before the index existed has no row at all, and the
 * account-connected event only fires on a fresh OAuth callback — so keying off
 * state rows alone would leave every already-connected mailbox permanently
 * un-indexed, which is exactly what happened the first time this shipped.
 *
 * Per status: no row means never started, so start. `running` was interrupted
 * mid-flight and nothing else will restart it. `failed` and `paused` are left
 * alone — a genuine failure must not be retried on every launch, and a paused
 * account resumes through the connected event when its grant comes back.
 */
export const startMailBackfill = Effect.fn("startMailBackfill")(
  function* startMailBackfill() {
    onGoogleAccountConnected(requestMailBackfill);

    const rows = yield* withDatabase(
      "Could not load the mail index state",
      (database) => database.query.gmailBackfillState.findMany()
    ).pipe(Effect.orElseSucceed(() => []));
    const stateByAccount = new Map(
      rows.map((row) => [row.accountEmail, row] as const)
    );
    const accountIds = yield* listReadableAccountIds().pipe(
      Effect.orElseSucceed(() => NO_ACCOUNT_IDS)
    );

    for (const accountId of accountIds) {
      const row = stateByAccount.get(accountId);
      const counts = yield* readCounts(accountId).pipe(
        Effect.orElseSucceed(() => ({ messages: 0, threads: 0 }))
      );

      publishProgress(
        toProgress(accountId, {
          estimatedThreads: row?.estimatedThreads ?? null,
          indexedMessages: counts.messages,
          indexedThreads: counts.threads,
          lastError: row?.lastError ?? null,
          oldestIndexedAt: row?.oldestIndexedAt ?? null,
          status: row?.status ?? "idle",
        })
      );

      if (row === undefined || row.status === "running") {
        requestMailBackfill(accountId);
      }
    }
  }
);
