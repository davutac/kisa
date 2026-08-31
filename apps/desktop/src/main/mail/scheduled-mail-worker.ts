/* oxlint-disable eslint/no-await-in-loop -- Durable mail claims and reconciliation transitions are intentionally serialized. */
import type {
  ScheduledMessageAttentionReason,
  StoredMailDraftAttachment,
} from "@repo/database/schemas";
import type { OutgoingAttachment } from "@repo/gmail/models";
import { Effect, Fiber } from "effect";

import { ScheduledMailAttachmentError } from "./scheduled-mail-attachment-error";
import { getScheduledMailKeyId } from "./scheduled-mail-keyed-serial";
import type { ScheduledMailWorkerError } from "./scheduled-mail-worker-error";
import { scheduledMailWorkerError } from "./scheduled-mail-worker-error";

export const SCHEDULED_MAIL_POLL_INTERVAL_MS = 30_000;
export const SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type ScheduledMailAttentionReason = ScheduledMessageAttentionReason;

export interface ScheduledMailKey {
  readonly accountId: string;
  readonly draftId: string;
}

export interface ScheduledMailDeliveryInput extends ScheduledMailKey {
  readonly attachments: readonly StoredMailDraftAttachment[];
  readonly bcc: readonly string[];
  readonly body: { readonly html: string; readonly text: string };
  readonly cc: readonly string[];
  readonly rfcMessageId: string;
  readonly subject: string;
  readonly to: readonly string[];
}

export interface ClaimedScheduledMail extends ScheduledMailDeliveryInput {
  readonly attemptCount: number;
  readonly attemptId: string;
  readonly isMessageValid: boolean;
  readonly rateLimitStartedAt?: number;
  readonly scheduledAt: number;
}

export interface RecoverableScheduledMail extends ScheduledMailKey {
  readonly rfcMessageId: string;
}

export type ScheduledMailReconciliation =
  | { readonly kind: "defer"; readonly retryAfterMs?: number }
  | { readonly kind: "found" }
  | { readonly kind: "missing" };

export type ScheduledMailDeliveryFailure =
  | {
      readonly kind: "rate-limited";
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind:
        | "account-action-required"
        | "delivery-rejected"
        | "message-invalid"
        | "outcome-unknown";
    };

export interface ScheduledMailNotification {
  readonly accountId: string;
  readonly draftId: string;
  readonly kind: "attention" | "sent";
}

export interface ScheduledMailWorkerStore {
  readonly claimDue: (
    now: number,
    attemptId: string
  ) => Promise<ClaimedScheduledMail | undefined>;
  readonly getNextAttemptAt: () => Promise<number | undefined>;
  readonly listSending: () => Promise<readonly RecoverableScheduledMail[]>;
  readonly markAttention: (
    item: ScheduledMailKey,
    attemptId: string | undefined,
    reason: ScheduledMailAttentionReason,
    now: number
  ) => Promise<boolean>;
  readonly markSent: (
    item: ScheduledMailKey,
    attemptId: string | undefined,
    now: number
  ) => Promise<boolean>;
  readonly markSending: (
    item: ScheduledMailKey,
    attemptId: string,
    now: number
  ) => Promise<boolean>;
  readonly releasePreparation: (
    item: ScheduledMailKey,
    attemptId: string,
    nextAttemptAt: number,
    now: number
  ) => Promise<boolean>;
  readonly resetPreparing: (now: number) => Promise<void>;
  readonly retryAfterRateLimit: (
    item: ClaimedScheduledMail,
    nextAttemptAt: number,
    rateLimitStartedAt: number,
    now: number
  ) => Promise<boolean>;
}

export interface ScheduledMailWorkerDependencies {
  readonly deliver: (
    item: ScheduledMailDeliveryInput,
    attachments: readonly OutgoingAttachment[],
    signal: AbortSignal
  ) => Promise<
    | { readonly ok: true }
    | { readonly error: ScheduledMailDeliveryFailure; readonly ok: false }
  >;
  readonly isOnline: () => boolean;
  readonly loadAttachments: (
    attachments: readonly StoredMailDraftAttachment[]
  ) => Promise<readonly OutgoingAttachment[]>;
  readonly notify: (notification: ScheduledMailNotification) => Promise<void>;
  readonly now: () => number;
  readonly randomId: () => string;
  readonly reconcile: (
    item: RecoverableScheduledMail,
    signal: AbortSignal
  ) => Promise<ScheduledMailReconciliation>;
  readonly runAccountWork: (
    accountId: string,
    work: (signal: AbortSignal) => Promise<void>,
    parentSignal: AbortSignal
  ) => Promise<void>;
  readonly schedule: (
    run: () => void,
    delayMs: number
  ) => { readonly cancel: () => void };
  readonly withKeyLock: <A>(
    key: ScheduledMailKey,
    run: () => Promise<A>
  ) => Promise<A>;
}

export const getScheduledMailRateLimitDelay = (
  attemptCount: number,
  retryAfterMs?: number
): number => {
  const exponential = Math.min(
    60 * 60 * 1000,
    60_000 * 2 ** Math.min(Math.max(0, attemptCount), 6)
  );
  return Math.max(exponential, retryAfterMs ?? 0);
};

const promiseEffect = <A>(
  run: (signal: AbortSignal) => PromiseLike<A>
): Effect.Effect<A, ScheduledMailWorkerError> =>
  Effect.tryPromise({ catch: scheduledMailWorkerError, try: run });

const earliestTime = (
  first: number | undefined,
  second: number | undefined
): number | undefined => {
  if (first === undefined) {
    return second;
  }
  return second === undefined ? first : Math.min(first, second);
};

export class ScheduledMailWorker {
  readonly #dependencies: ScheduledMailWorkerDependencies;
  readonly #reconcileAfter = new Map<string, number>();
  readonly #store: ScheduledMailWorkerStore;
  #running = false;
  #timer: { readonly cancel: () => void } | undefined;
  #wakeFiber: Fiber.Fiber<void> | undefined;
  #wakePending = false;

  constructor(
    store: ScheduledMailWorkerStore,
    dependencies: ScheduledMailWorkerDependencies
  ) {
    this.#store = store;
    this.#dependencies = dependencies;
  }

  start(): Promise<void> {
    return Effect.runPromise(this.#start());
  }

  stop(): Promise<void> {
    return Effect.runPromise(this.#stop());
  }

  wake(): Promise<void> {
    return Effect.runPromise(this.#wake());
  }

  #start(): Effect.Effect<void, ScheduledMailWorkerError> {
    return Effect.gen({ self: this }, function* startScheduledMailWorker() {
      if (this.#running) {
        return;
      }
      this.#running = true;
      yield* promiseEffect(() =>
        this.#store.resetPreparing(this.#dependencies.now())
      ).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            this.#running = false;
          }).pipe(Effect.andThen(Effect.fail(error)))
        )
      );
      yield* this.#wake();
    });
  }

  #stop(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* stopScheduledMailWorker() {
      this.#running = false;
      this.#wakePending = false;
      this.#timer?.cancel();
      this.#timer = undefined;
      this.#reconcileAfter.clear();
      const wakeFiber = this.#wakeFiber;
      if (wakeFiber !== undefined) {
        yield* Fiber.interrupt(wakeFiber);
      }
      this.#wakeFiber = undefined;
    });
  }

  #wake(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* wakeScheduledMailWorker() {
      if (!this.#running) {
        return;
      }
      this.#timer?.cancel();
      this.#timer = undefined;
      const current = this.#wakeFiber;
      if (current !== undefined) {
        this.#wakePending = true;
        yield* Fiber.await(current);
        if (
          this.#running &&
          this.#wakePending &&
          this.#wakeFiber === undefined
        ) {
          yield* this.#wake();
        }
        return;
      }
      const fiber = yield* Effect.forkDetach(this.#runWakeCycles());
      this.#wakeFiber = fiber;
      yield* Fiber.await(fiber);
    });
  }

  #runWakeCycles(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* runScheduledMailWakeCycles() {
      do {
        this.#wakePending = false;
        this.#timer?.cancel();
        this.#timer = undefined;
        yield* this.#runCycle().pipe(Effect.ignore);
        if (!this.#running || this.#wakePending) {
          continue;
        }
        yield* this.#armNextWake().pipe(
          // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Timer adapter failures fall back to a bounded poll.
          Effect.catch(() => Effect.sync(() => this.#armPollFallback()))
        );
      } while (this.#running && this.#wakePending);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          this.#wakeFiber = undefined;
        })
      )
    );
  }

  #armPollFallback(): void {
    if (!this.#running || this.#timer !== undefined) {
      return;
    }
    this.#timer = this.#dependencies.schedule(() => {
      this.#timer = undefined;
      void this.wake();
    }, SCHEDULED_MAIL_POLL_INTERVAL_MS);
  }

  #runCycle(): Effect.Effect<void, ScheduledMailWorkerError> {
    return Effect.gen({ self: this }, function* runScheduledMailCycle() {
      yield* this.#recoverSending();
      yield* this.#drain();
    });
  }

  #armNextWake(): Effect.Effect<void, ScheduledMailWorkerError> {
    return Effect.gen({ self: this }, function* armScheduledMailWake() {
      if (!this.#running || this.#timer !== undefined) {
        return;
      }
      const now = this.#dependencies.now();
      const nextAttemptAt = yield* promiseEffect(() =>
        this.#store.getNextAttemptAt()
      );
      const nextReconciliationAt =
        this.#reconcileAfter.size === 0
          ? undefined
          : Math.min(...this.#reconcileAfter.values());
      const nextWakeAt = earliestTime(nextAttemptAt, nextReconciliationAt);
      if (nextWakeAt === undefined) {
        return;
      }
      const untilNextAttempt = nextWakeAt - now;
      const delayMs =
        untilNextAttempt > 0
          ? Math.min(SCHEDULED_MAIL_POLL_INTERVAL_MS, untilNextAttempt)
          : SCHEDULED_MAIL_POLL_INTERVAL_MS;
      if (!this.#running) {
        return;
      }
      this.#timer = this.#dependencies.schedule(() => {
        this.#timer = undefined;
        void this.wake();
      }, delayMs);
    });
  }

  #drain(): Effect.Effect<void, ScheduledMailWorkerError> {
    return Effect.gen({ self: this }, function* drainScheduledMail() {
      const context = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(context);
      while (this.#running) {
        const now = this.#dependencies.now();
        const attemptId = this.#dependencies.randomId();
        const item = yield* promiseEffect(() =>
          this.#store.claimDue(now, attemptId)
        );
        if (item === undefined) {
          return;
        }
        if (!this.#running) {
          yield* promiseEffect(() =>
            this.#store.releasePreparation(
              item,
              attemptId,
              now + SCHEDULED_MAIL_POLL_INTERVAL_MS,
              now
            )
          );
          return;
        }
        let accountWorkStarted = false;
        const completed = yield* promiseEffect((parentSignal) =>
          this.#dependencies.runAccountWork(
            item.accountId,
            (signal) => {
              accountWorkStarted = true;
              return runPromise(this.#attempt(item, signal), { signal });
            },
            parentSignal
          )
        ).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false)
        );
        if (completed) {
          if (!accountWorkStarted) {
            const skippedAt = this.#dependencies.now();
            yield* promiseEffect(() =>
              this.#store.releasePreparation(
                item,
                item.attemptId,
                skippedAt + SCHEDULED_MAIL_POLL_INTERVAL_MS,
                skippedAt
              )
            );
          }
          continue;
        }
        const failedAt = this.#dependencies.now();
        yield* promiseEffect(() =>
          this.#store.releasePreparation(
            item,
            item.attemptId,
            failedAt + SCHEDULED_MAIL_POLL_INTERVAL_MS,
            failedAt
          )
        ).pipe(
          // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- A sending row stays durable for startup reconciliation if release fails.
          Effect.catch(() => Effect.void)
        );
        return;
      }
    });
  }

  #attempt(
    item: ClaimedScheduledMail,
    signal: AbortSignal
  ): Effect.Effect<void, ScheduledMailWorkerError> {
    let phase: "preparing" | "sending" | "terminal" = "preparing";
    return Effect.gen({ self: this }, function* attemptScheduledMailDelivery() {
      if (!item.isMessageValid) {
        yield* promiseEffect(() =>
          this.#store.markAttention(
            item,
            item.attemptId,
            "message-invalid",
            this.#dependencies.now()
          )
        );
        phase = "terminal";
        yield* this.#notify(item, "attention");
        return;
      }

      const startedAt = item.rateLimitStartedAt;
      if (
        startedAt !== undefined &&
        this.#dependencies.now() - startedAt >=
          SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS
      ) {
        yield* promiseEffect(() =>
          this.#store.markAttention(
            item,
            item.attemptId,
            "rate-limit-exhausted",
            this.#dependencies.now()
          )
        );
        phase = "terminal";
        yield* this.#notify(item, "attention");
        return;
      }

      if (!this.#dependencies.isOnline()) {
        const now = this.#dependencies.now();
        yield* promiseEffect(() =>
          this.#store.releasePreparation(
            item,
            item.attemptId,
            now + SCHEDULED_MAIL_POLL_INTERVAL_MS,
            now
          )
        );
        phase = "terminal";
        return;
      }

      const loaded = yield* Effect.tryPromise({
        catch: (error) =>
          error instanceof ScheduledMailAttachmentError
            ? error
            : scheduledMailWorkerError(error),
        try: () => this.#dependencies.loadAttachments(item.attachments),
      }).pipe(
        Effect.map((attachments) => ({ attachments, ok: true as const })),
        // oxlint-disable-next-line promise/prefer-await-to-callbacks, promise/prefer-await-to-then -- Attachment preparation failure is a durable attention transition.
        Effect.catch((error) => Effect.succeed({ error, ok: false as const }))
      );
      if (!loaded.ok) {
        const reason =
          loaded.error instanceof ScheduledMailAttachmentError
            ? loaded.error.reason
            : "attachment-invalid";
        yield* promiseEffect(() =>
          this.#store.markAttention(
            item,
            item.attemptId,
            reason,
            this.#dependencies.now()
          )
        );
        phase = "terminal";
        yield* this.#notify(item, "attention");
        return;
      }

      const maySend = yield* promiseEffect(() =>
        this.#dependencies.withKeyLock(item, () => {
          if (signal.aborted) {
            return Promise.resolve(false);
          }
          return this.#store.markSending(
            item,
            item.attemptId,
            this.#dependencies.now()
          );
        })
      );
      if (!maySend) {
        yield* promiseEffect(() =>
          this.#store.releasePreparation(
            item,
            item.attemptId,
            this.#dependencies.now() + SCHEDULED_MAIL_POLL_INTERVAL_MS,
            this.#dependencies.now()
          )
        );
        phase = "terminal";
        return;
      }
      phase = "sending";

      const outcome: Awaited<
        ReturnType<ScheduledMailWorkerDependencies["deliver"]>
      > = yield* promiseEffect(() =>
        this.#dependencies.deliver(item, loaded.attachments, signal)
      ).pipe(
        Effect.orElseSucceed(() => ({
          error: { kind: "outcome-unknown" } as const,
          ok: false as const,
        }))
      );
      const now = this.#dependencies.now();
      if (outcome.ok) {
        if (
          yield* promiseEffect(() =>
            this.#store.markSent(item, item.attemptId, now)
          )
        ) {
          phase = "terminal";
          yield* this.#notify(item, "sent");
        } else {
          phase = "terminal";
        }
        return;
      }

      if (outcome.error.kind === "rate-limited") {
        const { retryAfterMs } = outcome.error;
        const rateLimitStartedAt = item.rateLimitStartedAt ?? now;
        if (now - rateLimitStartedAt >= SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS) {
          yield* promiseEffect(() =>
            this.#store.markAttention(
              item,
              item.attemptId,
              "rate-limit-exhausted",
              now
            )
          );
          phase = "terminal";
          yield* this.#notify(item, "attention");
          return;
        }
        yield* promiseEffect(() =>
          this.#store.retryAfterRateLimit(
            item,
            Math.min(
              now +
                getScheduledMailRateLimitDelay(item.attemptCount, retryAfterMs),
              rateLimitStartedAt + SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS
            ),
            rateLimitStartedAt,
            now
          )
        );
        phase = "terminal";
        return;
      }

      const attentionReason = outcome.error.kind;
      yield* promiseEffect(() =>
        this.#store.markAttention(item, item.attemptId, attentionReason, now)
      );
      phase = "terminal";
      yield* this.#notify(item, "attention");
    }).pipe(
      Effect.onInterrupt(() =>
        this.#recoverInterruptedAttempt(item, phase).pipe(Effect.ignore)
      )
    );
  }

  #recoverInterruptedAttempt(
    item: ClaimedScheduledMail,
    phase: "preparing" | "sending" | "terminal"
  ): Effect.Effect<void, ScheduledMailWorkerError> {
    if (phase === "terminal") {
      return Effect.void;
    }
    const now = this.#dependencies.now();
    if (phase === "preparing") {
      return promiseEffect(() =>
        this.#store.releasePreparation(
          item,
          item.attemptId,
          now + SCHEDULED_MAIL_POLL_INTERVAL_MS,
          now
        )
      ).pipe(Effect.asVoid);
    }
    return promiseEffect(() =>
      this.#store.markAttention(item, item.attemptId, "outcome-unknown", now)
    ).pipe(
      Effect.flatMap((changed) =>
        changed ? this.#notify(item, "attention") : Effect.void
      )
    );
  }

  #recoverSending(): Effect.Effect<void, ScheduledMailWorkerError> {
    return Effect.gen({ self: this }, function* recoverSendingScheduledMail() {
      const context = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(context);
      const sending = yield* promiseEffect(() => this.#store.listSending());
      const presentKeys = new Set(sending.map(getScheduledMailKeyId));
      for (const key of this.#reconcileAfter.keys()) {
        if (!presentKeys.has(key)) {
          this.#reconcileAfter.delete(key);
        }
      }
      for (const item of sending) {
        if (!this.#running) {
          return;
        }
        const key = getScheduledMailKeyId(item);
        const now = this.#dependencies.now();
        if ((this.#reconcileAfter.get(key) ?? 0) > now) {
          continue;
        }
        if (!this.#dependencies.isOnline()) {
          this.#reconcileAfter.set(key, now + SCHEDULED_MAIL_POLL_INTERVAL_MS);
          continue;
        }
        let started = false;
        let handled = false;
        const completed = yield* promiseEffect((parentSignal) =>
          this.#dependencies.runAccountWork(
            item.accountId,
            (signal) => {
              started = true;
              return runPromise(
                this.#reconcile(item, key, signal).pipe(
                  Effect.tap(() =>
                    Effect.sync(() => {
                      handled = true;
                    })
                  )
                ),
                { signal }
              );
            },
            parentSignal
          )
        ).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false)
        );
        if (!this.#running) {
          return;
        }
        if (!completed || !started || !handled) {
          this.#reconcileAfter.set(
            key,
            this.#dependencies.now() + SCHEDULED_MAIL_POLL_INTERVAL_MS
          );
        }
      }
    });
  }

  #reconcile(
    item: RecoverableScheduledMail,
    key: string,
    signal: AbortSignal
  ): Effect.Effect<void, ScheduledMailWorkerError> {
    return Effect.gen({ self: this }, function* reconcileScheduledMail() {
      const reconciliation = yield* promiseEffect(() =>
        this.#dependencies.reconcile(item, signal)
      );
      if (!this.#running || signal.aborted) {
        return;
      }
      if (reconciliation.kind === "defer") {
        this.#reconcileAfter.set(
          key,
          this.#dependencies.now() +
            Math.max(
              SCHEDULED_MAIL_POLL_INTERVAL_MS,
              reconciliation.retryAfterMs ?? 0
            )
        );
        return;
      }
      if (reconciliation.kind === "missing") {
        this.#reconcileAfter.delete(key);
        yield* promiseEffect(() =>
          this.#store.markAttention(
            item,
            undefined,
            "outcome-unknown",
            this.#dependencies.now()
          )
        );
        yield* this.#notify(item, "attention");
        return;
      }
      if (
        yield* promiseEffect(() =>
          this.#store.markSent(item, undefined, this.#dependencies.now())
        )
      ) {
        this.#reconcileAfter.delete(key);
        yield* this.#notify(item, "sent");
      }
    });
  }

  #notify(
    item: ScheduledMailKey,
    kind: ScheduledMailNotification["kind"]
  ): Effect.Effect<void> {
    return promiseEffect(() =>
      this.#dependencies.notify({
        accountId: item.accountId,
        draftId: item.draftId,
        kind,
      })
    ).pipe(Effect.ignore);
  }
}
