import { mailMailboxes, mailMessages } from "@repo/database/schemas";
import { fetchAttachment } from "@repo/mail/attachments";
import { dialects } from "@repo/mail/dialects";
import { MailProtocolError } from "@repo/mail/errors";
import type { MailTransportError } from "@repo/mail/errors";
import { AccountId, MessageId, ThreadId } from "@repo/mail/ids";
import { createLabel, deleteLabel, renameLabel } from "@repo/mail/labels";
import { applyThreadAction } from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import type { ImapConnector, ImapSession } from "@repo/mail/session";
import type { SmtpTransport } from "@repo/mail/smtp";
import { MailEngineStore } from "@repo/mail/store";
import type { MailAccount, ThreadChanges } from "@repo/mail/store";
import {
  NO_THREAD_CHANGES,
  bodyStep,
  loadThreadBodies,
  mergeThreadChanges,
  skeletonStep,
  syncAccount,
} from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { and, eq, sql } from "drizzle-orm";
import {
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Option,
  Schema,
  Semaphore,
} from "effect";

import {
  MAIL_INDEX_PROGRESS_CHANNEL,
  MAIL_LABEL_CATALOG_CHANGED_CHANNEL,
  MAIL_SYNC_STATUS_CHANNEL,
  MAIL_THREAD_LIST_UPDATED_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  MailIndexProgressList,
  MailLabelCatalogChanged,
  MailSyncStatus,
  MailThreadListUpdated,
} from "../../../shared/ipc/mail";
import type {
  MailIndexProgress,
  MailThread,
  MailThreadListChange,
  ThreadMessage,
  MailThreadRequest,
} from "../../../shared/ipc/mail";
import { canApplySenderTrust } from "../../../shared/sender-trust";
import { onAccountConnected } from "../../auth/account-events";
import { sendRendererEvent } from "../../electron/renderer-events";
import { accountMailWorkSupervisor } from "../account-mail-work-supervisor";
import {
  inlineImageDataUrls,
  normalizeContentId,
  selectInlineImages,
  toImageDataUrl,
} from "../inline-images";
import { dismissInactiveThreadNotifications } from "../new-mail-notifications";
import { getSenderBrand } from "../sender-brand";
import { loadTrustedImageSenderCheck } from "../trusted-image-senders";
import { refreshUnreadBadge } from "../unread-badge";
import { createAccountWorker, toCycleOutcome } from "./account-worker";
import type { AccountWorker, SyncRequestSource } from "./account-worker";
import { ImapFlowConnectorLive } from "./imap-session";
import { announceArrivals } from "./mail-arrivals";
import type { ArrivalActions } from "./mail-arrivals";
import { MailDatabase } from "./mail-database";
import { MailDatabaseLive } from "./mail-database-live";
import { readConversation, readThreadSummaries } from "./mail-reads";
import type { ConversationMessage } from "./mail-reads";
import {
  closeAccountSessions,
  closeAllSessions,
  withAccountSession,
} from "./mail-sessions";
import { MailEngineStoreLive } from "./mail-store";
import { SmtpTransportLive } from "./smtp-transport";

// oxlint-disable-next-line unicorn/throw-new-error
export class MailEngineError extends Schema.TaggedError<MailEngineError>()(
  "MailEngineError",
  { message: Schema.String }
) {}

const EngineLayer = Layer.mergeAll(
  MailEngineStoreLive,
  ImapFlowConnectorLive,
  SmtpTransportLive
).pipe(Layer.provideMerge(MailDatabaseLive));

const engineRuntime = ManagedRuntime.make(EngineLayer);

export type EngineServices =
  | ImapConnector
  | MailDatabase
  | MailEngineStore
  | SmtpTransport;

export const runEngine = <A, E>(
  effect: Effect.Effect<A, E, EngineServices>,
  options?: { readonly signal?: AbortSignal }
): Promise<A> => engineRuntime.runPromise(effect, options);

/** Like `runEngine`, keeping a typed failure in the exit. */
export const runEngineExit = <A, E>(
  effect: Effect.Effect<A, E, EngineServices>,
  options?: { readonly signal?: AbortSignal }
): Promise<Exit.Exit<A, E>> => engineRuntime.runPromiseExit(effect, options);

/**
 * Runs an engine effect from code outside the engine (IPC handlers), keeping
 * its typed failure and interrupting it if the caller is interrupted.
 */
export const inEngine = <A, E>(
  effect: Effect.Effect<A, E, EngineServices>
): Effect.Effect<A, E> =>
  Effect.flatMap(
    Effect.promise((signal) =>
      engineRuntime.runPromiseExit(effect, { signal })
    ),
    (exit) => exit
  );

/**
 * Runs foreground work for one account under its work supervisor, so
 * disconnecting cancels it and waits for it before the account's mail is
 * deleted. Work for an account being disconnected does not start.
 */
export const inAccountEngine = <A, E>(
  accountId: string,
  effect: Effect.Effect<A, E, EngineServices>
): Effect.Effect<A, E | MailEngineError> =>
  Effect.flatMap(
    Effect.promise(async (signal) => {
      let exit: Exit.Exit<A, E> | undefined;
      await accountMailWorkSupervisor.run(
        accountId,
        async (workSignal) => {
          exit = await engineRuntime.runPromiseExit(effect, {
            signal: workSignal,
          });
        },
        signal
      );
      return exit;
    }),
    (exit): Effect.Effect<A, E | MailEngineError> =>
      exit ??
      Effect.fail(
        new MailEngineError({ message: "This account is being disconnected" })
      )
  );

/**
 * Starts account work that the caller does not wait for, with the caller's
 * services. It runs under the account's work supervisor, so disconnecting the
 * account cancels it and waits for it, and it does not start while the
 * account is being disconnected. It handles its own failures.
 */
export const forkAccountWork = <R>(
  accountId: string,
  effect: Effect.Effect<void, never, R>
): Effect.Effect<void, never, R> =>
  Effect.flatMap(Effect.context<R>(), (context) =>
    Effect.sync(() => {
      void accountMailWorkSupervisor.run(accountId, async (signal) => {
        await Effect.runPromiseExitWith(context)(effect, { signal });
      });
    })
  );

/** Between polls while nothing else wakes the account. */
const POLL_INTERVAL_MS = 2 * 60_000;
/** How long one background cycle works before syncing new mail again. */
const CYCLE_BUDGET_MS = 20_000;
/** Bodies inside this window download first, before older mail. */
const RECENT_BODY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const RETRY_DELAYS_MS = [5000, 15_000, 60_000, 5 * 60_000] as const;
/** Renderer upserts per event; deeper threads arrive through paging. */
const MAX_UPSERTS = 200;
const PROGRESS_INTERVAL_MS = 1000;

const scopeOf = (account: MailAccount, session: ImapSession): SyncScope => ({
  accountId: account.accountId,
  dialect: dialects[account.dialect],
  session,
});

export const requireAccount = Effect.fn("MailEngine.requireAccount")(
  function* requireAccount(accountId: string) {
    const store = yield* MailEngineStore;
    const account = yield* store.getAccount(AccountId.make(accountId));

    if (Option.isNone(account)) {
      return yield* new MailEngineError({
        message: "This account is not connected",
      });
    }

    return account.value;
  }
);

/**
 * Background sync and foreground actions both rewrite an account's cached
 * copies from what they last saw on the server. Taking turns keeps a view
 * read before an action from undoing what the action just cached.
 */
const cacheLocks = new Map<string, Semaphore.Semaphore>();

export const withCacheLock = <A, E, R>(
  accountId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => {
  let lock = cacheLocks.get(accountId);
  if (lock === undefined) {
    lock = Semaphore.makeUnsafe(1);
    cacheLocks.set(accountId, lock);
  }
  return lock.withPermit(effect);
};

// ----------------------------------------------------------------- events

/**
 * Upserts for the newest changed threads and removals for every removed
 * one. A reload is never sent: it would put a scrolled list back at the top,
 * and threads past the loaded pages arrive through ordinary paging.
 */
export const publishChanges = Effect.fn("MailEngine.publishChanges")(
  function* publishChanges(accountId: string, changes: ThreadChanges) {
    if (changes.changed.length === 0 && changes.removed.length === 0) {
      return;
    }

    const database = yield* MailDatabase;
    const summaries = yield* database.use("Could not load updated mail", (db) =>
      readThreadSummaries(db, accountId, changes.changed)
    );
    const list: MailThreadListChange[] = [
      ...summaries
        .toSorted((left, right) => right.latestAt - left.latestAt)
        .slice(0, MAX_UPSERTS)
        .map((thread) => ({ kind: "upsert" as const, thread })),
      ...changes.removed.map((threadId) => ({
        accountId,
        kind: "remove" as const,
        threadId,
      })),
    ];

    yield* Effect.sync(() => {
      dismissInactiveThreadNotifications(list);
      sendRendererEvent(
        MAIL_THREAD_LIST_UPDATED_CHANNEL,
        MailThreadListUpdated,
        {
          changes: list,
        }
      );
    });
    yield* refreshUnreadBadge().pipe(Effect.ignore);
  }
);

/**
 * One background loop per connected account. A worker's phase is the only
 * record of what its loop is doing: the syncing list and the index status
 * the windows receive are both derived from it.
 */
const workers = new Map<string, AccountWorker>();

/** The accounts whose loop is in its catch-up pass right now. */
export const getMailEngineSyncStatus = (): MailSyncStatus => ({
  accountIds: [...workers]
    .filter(([, worker]) => worker.phase().kind === "syncing")
    .map(([accountId]) => accountId),
});

const sendSyncStatus = (): void => {
  sendRendererEvent(
    MAIL_SYNC_STATUS_CHANNEL,
    MailSyncStatus,
    getMailEngineSyncStatus()
  );
};

/**
 * An account's index progress from its counts. A body the background gave up
 * on (`failed`) counts as done: only opening its conversation tries it again,
 * so counting it as pending would leave the index running forever.
 */
export const toMailIndexProgress = (
  accountId: string,
  counts: {
    readonly estimatedMessages: number;
    readonly oldestIndexedAt: number | undefined;
    readonly pendingBodies: number;
    readonly totalMessages: number;
    readonly unfinishedMailboxes: number;
  }
): MailIndexProgress => ({
  accountId,
  estimatedMessages: Math.max(counts.estimatedMessages, counts.totalMessages),
  indexedMessages: counts.totalMessages - counts.pendingBodies,
  indexedThreads: 0,
  oldestIndexedAt: counts.oldestIndexedAt,
  status:
    counts.unfinishedMailboxes === 0 && counts.pendingBodies === 0
      ? "complete"
      : "running",
});

const readIndexProgress = Effect.fn("MailEngine.readIndexProgress")(
  function* readIndexProgress(accountId: string) {
    const database = yield* MailDatabase;
    return yield* database.use(
      "Could not read indexing progress",
      async (db) => {
        const [messages] = await db
          .select({
            oldest: sql<number | null>`min(${mailMessages.receivedAt})`,
            pending: sql<number>`coalesce(sum(${mailMessages.bodyState} = 'none'), 0)`,
            total: sql<number>`count(*)`,
          })
          .from(mailMessages)
          .where(eq(mailMessages.accountId, accountId))
          .all();
        const [mailboxes] = await db
          .select({
            estimated: sql<number>`coalesce(sum(${mailMailboxes.messageCount}), 0)`,
            unfinished: sql<number>`coalesce(sum(${mailMailboxes.skeletonFloor} is null or ${mailMailboxes.skeletonFloor} > 1), 0)`,
          })
          .from(mailMailboxes)
          .where(
            and(
              eq(mailMailboxes.accountId, accountId),
              eq(mailMailboxes.synced, true)
            )
          )
          .all();
        return toMailIndexProgress(accountId, {
          estimatedMessages: mailboxes?.estimated ?? 0,
          oldestIndexedAt: messages?.oldest ?? undefined,
          pendingBodies: messages?.pending ?? 0,
          totalMessages: messages?.total ?? 0,
          unfinishedMailboxes: mailboxes?.unfinished ?? 1,
        });
      }
    );
  }
);

const progressPublishedAt = new Map<string, number>();
const latestProgress = new Map<string, MailIndexProgress>();

export const getMailEngineIndexProgress = (): readonly MailIndexProgress[] => [
  ...latestProgress.values(),
];

/**
 * Every account's progress in one event: the renderer replaces its list with
 * what arrives, so an event naming one account would drop the others.
 */
const sendIndexProgress = (): void => {
  sendRendererEvent(MAIL_INDEX_PROGRESS_CHANNEL, MailIndexProgressList, {
    accounts: getMailEngineIndexProgress(),
  });
};

const publishProgress = Effect.fn("MailEngine.publishProgress")(
  function* publishProgress(accountId: string, force = false) {
    const now = Date.now();
    if (
      !force &&
      now - (progressPublishedAt.get(accountId) ?? 0) < PROGRESS_INTERVAL_MS
    ) {
      return;
    }
    progressPublishedAt.set(accountId, now);
    const progress = yield* readIndexProgress(accountId);
    // Read at write time: the account may have been disconnected, or its
    // loop may have moved on, while the counts were being read.
    const worker = workers.get(accountId);
    if (worker === undefined) {
      return;
    }
    latestProgress.set(accountId, {
      ...progress,
      status: worker.indexStatus() ?? progress.status,
    });
    yield* Effect.sync(sendIndexProgress);
  }
);

// --------------------------------------------------------------- background

/**
 * A notification's buttons act on the conversation under the account's work
 * supervisor, so disconnecting the account cancels them.
 */
const actFromNotification =
  (action: ThreadAction): ArrivalActions["markRead"] =>
  (request) => {
    void accountMailWorkSupervisor.run(request.accountId, async (signal) => {
      await runEngineExit(
        applyThreadActions(request.accountId, [request.threadId], action),
        { signal }
      );
    });
  };

const notificationActions: ArrivalActions = {
  markRead: actFromNotification({ kind: "setRead", read: true }),
  trash: actFromNotification({ kind: "trash" }),
};

/**
 * One background cycle: catch up with the server, then spend the budget on
 * the skeleton walk and on bodies, newest first. Reports whether background
 * work is left, so the loop knows whether to continue at once or wait.
 */
const backgroundCycle = Effect.fn("MailEngine.backgroundCycle")(
  function* backgroundCycle(
    accountId: string,
    cycle: { readonly syncPassEnded: (caughtUp: boolean) => void }
  ) {
    const account = yield* requireAccount(accountId);

    return yield* withAccountSession(account, "background", (session) =>
      Effect.gen(function* runCycle() {
        const scope = scopeOf(account, session);

        const synced = yield* syncAccount({
          ...scope,
          // Taken per mailbox, so a change the user makes waits for one
          // mailbox at most rather than the whole pass.
          exclusive: (effect) => withCacheLock(accountId, effect),
        }).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              cycle.syncPassEnded(Exit.isSuccess(exit));
            })
          )
        );
        yield* publishChanges(accountId, synced);
        yield* announceArrivals(
          accountId,
          synced.arrived ?? [],
          notificationActions
        ).pipe(Effect.ignore);
        yield* publishProgress(accountId, true);

        const deadline = Date.now() + CYCLE_BUDGET_MS;
        while (Date.now() < deadline) {
          const skeleton = yield* withCacheLock(accountId, skeletonStep(scope));
          const recent = yield* bodyStep(scope, {
            receivedAfter: Date.now() - RECENT_BODY_WINDOW_MS,
          });
          const older =
            skeleton === undefined && recent === undefined
              ? yield* bodyStep(scope)
              : undefined;

          if (
            skeleton === undefined &&
            recent === undefined &&
            older === undefined
          ) {
            yield* publishProgress(accountId, true);
            return { moreWork: false };
          }

          yield* publishChanges(
            accountId,
            mergeThreadChanges(
              skeleton ?? NO_THREAD_CHANGES,
              recent ?? NO_THREAD_CHANGES,
              older ?? NO_THREAD_CHANGES
            )
          );
          yield* publishProgress(accountId);
        }

        return { moreWork: true };
      })
    );
  }
);

let isEngineRunning = false;

/**
 * Starts an account's loop under its work supervisor, so disconnecting
 * aborts it and waits for it. A refused sign-in parks the loop until the
 * account is connected again or the user asks to sync; only a missing
 * account ends it.
 */
const startAccountWorker = (accountId: string): void => {
  if (!isEngineRunning || workers.has(accountId)) {
    return;
  }

  let isSyncing = false;
  let indexStatus: ReturnType<AccountWorker["indexStatus"]>;
  const worker = createAccountWorker({
    now: Date.now,
    onPhaseChange: (phase) => {
      if (workers.get(accountId) !== worker) {
        return;
      }
      if (isSyncing !== (phase.kind === "syncing")) {
        isSyncing = phase.kind === "syncing";
        sendSyncStatus();
      }
      // The worker changes its phase whenever its trouble begins or ends.
      const nextIndexStatus = worker.indexStatus();
      if (indexStatus !== nextIndexStatus) {
        indexStatus = nextIndexStatus;
        // A cycle publishes progress only after a sync pass that worked, so
        // an account refused from the start would otherwise have no entry.
        void runEngineExit(publishProgress(accountId, true));
      }
    },
    pollIntervalMs: POLL_INTERVAL_MS,
    retryDelaysMs: RETRY_DELAYS_MS,
    runCycle: async (cycle, signal) =>
      toCycleOutcome(
        await engineRuntime.runPromiseExit(backgroundCycle(accountId, cycle), {
          signal,
        })
      ),
    schedule: (run, delayMs) => {
      const timeout = setTimeout(run, delayMs);
      return {
        cancel: () => {
          clearTimeout(timeout);
        },
      };
    },
  });
  workers.set(accountId, worker);

  const runWorker = async (): Promise<void> => {
    try {
      await accountMailWorkSupervisor.run(accountId, (signal) =>
        worker.run(signal)
      );
    } catch {
      // The loop handles its own failures; it only ends on purpose.
    } finally {
      if (workers.get(accountId) === worker) {
        workers.delete(accountId);
      }
    }
  };

  void runWorker();
};

/**
 * Asks an account's loop, or every loop, to sync: when a window gains focus,
 * after a send or a failed change, on Sync now, or once an account is
 * connected again. The loop decides what the request does in its phase.
 */
export const requestMailSync = (
  accountId?: string,
  source: SyncRequestSource = "automatic"
): void => {
  const targets =
    accountId === undefined ? [...workers.values()] : [workers.get(accountId)];
  for (const worker of targets) {
    worker?.requestSync(source);
  }
};

let stopListeningForAccounts: (() => void) | undefined;

/** Coming back to Kisa checks for mail, at most this often. */
const FOCUS_SYNC_INTERVAL_MS = 30_000;
let lastFocusSyncAt = 0;

/**
 * Without IDLE the loop polls every two minutes, so mail read elsewhere or
 * just arrived would otherwise look stale when the user returns.
 */
export const syncOnFocus = (): void => {
  const now = Date.now();
  if (now - lastFocusSyncAt >= FOCUS_SYNC_INTERVAL_MS) {
    lastFocusSyncAt = now;
    requestMailSync();
  }
};

export const startMailEngine = async (): Promise<void> => {
  if (isEngineRunning) {
    return;
  }
  isEngineRunning = true;
  stopListeningForAccounts = onAccountConnected((accountId) => {
    if (workers.has(accountId)) {
      requestMailSync(accountId, "account-connected");
    } else {
      startAccountWorker(accountId);
    }
  });

  const accountIds = await runEngine(
    Effect.gen(function* listAccountIds() {
      const database = yield* MailDatabase;
      return yield* database.use("Could not load mail accounts", (db) =>
        db.query.mailAccounts.findMany({ columns: { accountId: true } })
      );
    })
  ).catch(() => []);

  for (const { accountId } of accountIds) {
    startAccountWorker(accountId);
  }
};

export const stopMailEngine = async (): Promise<void> => {
  isEngineRunning = false;
  stopListeningForAccounts?.();
  stopListeningForAccounts = undefined;
  // Work forked for an account, such as a Sent copy still being waited for,
  // can outlive the account's background loop, so both are stopped.
  const accountIds = new Set([
    ...workers.keys(),
    ...accountMailWorkSupervisor.activeAccountIds(),
  ]);
  await Promise.allSettled(
    [...accountIds].map((accountId) =>
      Effect.runPromise(accountMailWorkSupervisor.suspend(accountId)).finally(
        () => {
          accountMailWorkSupervisor.resume(accountId);
        }
      )
    )
  );
  try {
    await runEngine(closeAllSessions);
  } catch {
    // Closing connections on quit is best effort.
  }
};

/**
 * Deletes everything cached for an account. The caller has suspended the
 * account's work first, so nothing writes to it meanwhile.
 */
export const forgetMailEngineAccount = Effect.fn("MailEngine.forgetAccount")(
  function* forgetMailEngineAccount(accountId: string) {
    const wasSyncing = workers.get(accountId)?.phase().kind === "syncing";
    workers.delete(accountId);
    cacheLocks.delete(accountId);
    latestProgress.delete(accountId);
    progressPublishedAt.delete(accountId);
    sendIndexProgress();
    if (wasSyncing) {
      sendSyncStatus();
    }
    yield* Effect.promise(() => runEngine(closeAccountSessions(accountId)));
    yield* Effect.tryPromise({
      catch: () =>
        new MailEngineError({ message: "Could not remove the account's mail" }),
      try: () =>
        runEngine(
          Effect.gen(function* clearCachedAccount() {
            const store = yield* MailEngineStore;
            yield* store.clearAccount(AccountId.make(accountId));
          })
        ),
    });
    yield* refreshUnreadBadge().pipe(Effect.ignore);
  }
);

// --------------------------------------------------------------- foreground

export const withForeground = <A, E>(
  account: MailAccount,
  use: (scope: SyncScope) => Effect.Effect<A, E, EngineServices>
): Effect.Effect<A, E | MailTransportError, EngineServices> =>
  withAccountSession(account, "foreground", (session) =>
    use(scopeOf(account, session))
  );

const INLINE_IMAGE_CONCURRENCY = 3;

/**
 * Replaces `cid:` references with the image parts they name. An image that
 * cannot be fetched keeps its dead reference rather than failing the thread.
 */
const withInlineImages = Effect.fn("MailEngine.withInlineImages")(
  function* withInlineImages(
    account: MailAccount,
    sources: readonly ConversationMessage[],
    messages: readonly ThreadMessage[]
  ) {
    const wanted = sources.flatMap((source, index) => {
      const html = messages[index]?.body.html;
      return html === undefined
        ? []
        : selectInlineImages(html, source.attachments).map((attachment) => ({
            attachment,
            index,
          }));
    });

    if (wanted.length === 0) {
      return messages;
    }

    const loaded = yield* withForeground(account, (scope) =>
      Effect.forEach(
        wanted,
        ({ attachment, index }) =>
          fetchAttachment(
            scope,
            MessageId.make(messages[index]?.id ?? ""),
            attachment.section
          ).pipe(
            Effect.map((image) =>
              image === undefined
                ? null
                : {
                    contentId: normalizeContentId(attachment.contentId),
                    dataUrl: toImageDataUrl(image.mediaType, image.bytes),
                    index,
                    section: attachment.section,
                  }
            ),
            Effect.orElseSucceed(() => null)
          ),
        { concurrency: INLINE_IMAGE_CONCURRENCY }
      )
    ).pipe(Effect.orElseSucceed(() => []));

    return messages.map((message, index) => {
      const images = loaded.filter(
        (image) => image?.index === index && image.dataUrl !== undefined
      );
      if (images.length === 0 || message.body.html === undefined) {
        return message;
      }
      const sections = new Set(images.map((image) => image?.section));
      const dataUrls = new Map(
        images.flatMap((image) =>
          image?.dataUrl === undefined
            ? []
            : [[image.contentId, image.dataUrl] as const]
        )
      );
      return {
        ...message,
        attachments: message.attachments.filter(
          (attachment) => !sections.has(attachment.partId)
        ),
        body: {
          ...message.body,
          html: inlineImageDataUrls(message.body.html, dataUrls),
        },
      };
    });
  }
);

const withSenderBrands = Effect.fn("MailEngine.withSenderBrands")(
  function* withSenderBrands(
    accountId: string,
    sources: readonly ConversationMessage[]
  ) {
    // Looking up a logo the cache lacks contacts the sender's DNS and web
    // servers, so it needs the same consent as remote images.
    const isTrusted = yield* loadTrustedImageSenderCheck(accountId).pipe(
      Effect.orElseSucceed(() => () => false)
    );

    return yield* Effect.forEach(
      sources,
      (source) =>
        getSenderBrand({
          allowDiscovery:
            canApplySenderTrust(source.message) &&
            isTrusted(source.fromAddress),
          from: source.fromAddress,
          headers: source.headers,
        }).pipe(
          Effect.orElseSucceed(() => null),
          Effect.map((brand): ThreadMessage =>
            brand === null
              ? source.message
              : { ...source.message, senderBrand: brand }
          )
        ),
      { concurrency: 3 }
    );
  }
);

/**
 * An action on the account's foreground connection with the cache lock
 * held. What changed is published; a failure may have reached the server
 * part way, so the account is synced to bring the cache back in line.
 */
const runAction = <A, E>(
  account: MailAccount,
  action: (scope: SyncScope) => Effect.Effect<A, E, EngineServices>,
  changesOf: (result: A) => ThreadChanges
) =>
  withForeground(account, (scope) =>
    withCacheLock(account.accountId, action(scope))
  ).pipe(
    Effect.tap((result) =>
      publishChanges(account.accountId, changesOf(result)).pipe(
        Effect.tapError(() =>
          Effect.sync(() => requestMailSync(account.accountId))
        ),
        Effect.ignore,
        // A refresh after the change may be the first to see new mail; the
        // next background pass would take it as known and stay quiet.
        Effect.andThen(
          announceArrivals(
            account.accountId,
            changesOf(result).arrived ?? [],
            notificationActions
          ).pipe(Effect.ignore)
        )
      )
    ),
    Effect.onError(() => Effect.sync(() => requestMailSync(account.accountId)))
  );

const markRead = (account: MailAccount, threadId: string, read: boolean) =>
  runAction(
    account,
    (scope) =>
      applyThreadAction(scope, [ThreadId.make(threadId)], {
        kind: "setRead",
        read,
      }),
    (changes) => changes
  );

/** Applies one action to conversations of one account. */
export const applyThreadActions = Effect.fn("MailEngine.applyThreadActions")(
  function* applyThreadActions(
    accountId: string,
    threadIds: readonly string[],
    action: ThreadAction
  ) {
    const account = yield* requireAccount(accountId);
    yield* runAction(
      account,
      (scope) =>
        applyThreadAction(
          scope,
          threadIds.map((threadId) => ThreadId.make(threadId)),
          action
        ),
      (changes) => changes
    );
  }
);

const publishLabelCatalogChanged = (accountId: string) =>
  Effect.sync(() => {
    sendRendererEvent(
      MAIL_LABEL_CATALOG_CHANGED_CHANNEL,
      MailLabelCatalogChanged,
      { accountId }
    );
  });

export const createAccountLabel = Effect.fn("MailEngine.createAccountLabel")(
  function* createAccountLabel(accountId: string, name: string) {
    const account = yield* requireAccount(accountId);
    const created = yield* runAction(
      account,
      (scope) => createLabel(scope, name),
      (result) => result.changes
    );
    yield* publishLabelCatalogChanged(accountId);
    return created.label;
  }
);

export const renameAccountLabel = Effect.fn("MailEngine.renameAccountLabel")(
  function* renameAccountLabel(
    accountId: string,
    labelId: string,
    name: string
  ) {
    const account = yield* requireAccount(accountId);
    const renamed = yield* runAction(
      account,
      (scope) => renameLabel(scope, labelId, name),
      (result) => result.changes
    );
    yield* publishLabelCatalogChanged(accountId);
    return renamed.label;
  }
);

export const deleteAccountLabel = Effect.fn("MailEngine.deleteAccountLabel")(
  function* deleteAccountLabel(accountId: string, labelId: string) {
    const account = yield* requireAccount(accountId);
    yield* runAction(
      account,
      (scope) => deleteLabel(scope, labelId),
      (changes) => changes
    );
    yield* publishLabelCatalogChanged(accountId);
  }
);

/**
 * Opens a conversation from the cache, first downloading any bodies the
 * background has not reached. Offline, what is cached is shown. Opening an
 * unread conversation marks it read, as Gmail does.
 */
export const loadThread = Effect.fn("MailEngine.loadThread")(
  function* loadThread(request: MailThreadRequest) {
    const database = yield* MailDatabase;
    const read = () =>
      database.use("Could not load email", (db) =>
        readConversation(db, request.accountId, request.threadId)
      );
    let conversation = yield* read();

    if (conversation === undefined) {
      return yield* new MailEngineError({
        message: "This conversation is no longer available",
      });
    }

    const account = yield* requireAccount(request.accountId);

    if (conversation.missingBodies) {
      const fetched = yield* withForeground(account, (scope) =>
        loadThreadBodies(scope, ThreadId.make(request.threadId))
      ).pipe(Effect.orElseSucceed(() => NO_THREAD_CHANGES));
      yield* publishChanges(request.accountId, fetched);
      conversation = (yield* read()) ?? conversation;
    }

    const branded = yield* withSenderBrands(
      request.accountId,
      conversation.messages
    );
    const messages = yield* withInlineImages(
      account,
      conversation.messages,
      branded
    );

    if (conversation.isUnread) {
      yield* markRead(account, request.threadId, true).pipe(
        Effect.catch(() =>
          Effect.logWarning("Could not mark a conversation read")
        )
      );
    }

    return {
      accountId: request.accountId,
      labels: conversation.labels,
      messages,
      subject: conversation.subject,
      threadId: request.threadId,
    } satisfies MailThread;
  }
);

/** Downloads the bodies of a conversation the background has not reached. */
export const ensureThreadBodies = Effect.fn("MailEngine.ensureThreadBodies")(
  function* ensureThreadBodies(accountId: string, threadId: string) {
    const account = yield* requireAccount(accountId);
    const fetched = yield* withForeground(account, (scope) =>
      loadThreadBodies(scope, ThreadId.make(threadId))
    );
    yield* publishChanges(accountId, fetched);
  }
);

export const setThreadReadState = Effect.fn("MailEngine.setThreadReadState")(
  function* setThreadReadState(
    request: MailThreadRequest & { readonly isRead: boolean }
  ) {
    const account = yield* requireAccount(request.accountId);
    yield* markRead(account, request.threadId, request.isRead);
  }
);

/** One attachment's bytes, downloaded on demand over the foreground lane. */
export const loadAttachment = Effect.fn("MailEngine.loadAttachment")(
  function* loadAttachment(request: {
    readonly accountId: string;
    readonly messageId: string;
    readonly section: string;
  }) {
    const account = yield* requireAccount(request.accountId);
    const attachment = yield* withForeground(account, (scope) =>
      fetchAttachment(scope, MessageId.make(request.messageId), request.section)
    );

    if (attachment === undefined) {
      return yield* new MailProtocolError({
        accountId: account.accountId,
        message: "The attachment is no longer on the server",
      });
    }

    return attachment;
  }
);
