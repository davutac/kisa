import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import type { OutgoingAttachment } from "@repo/gmail/models";
import { describe, expect, it, vi } from "vitest";

import { scheduledMailAttachmentError } from "../src/main/mail/scheduled-mail-attachment-error";
import { loadScheduledAttachments } from "../src/main/mail/scheduled-mail-attachments";
import {
  SCHEDULED_MAIL_POLL_INTERVAL_MS,
  SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS,
  ScheduledMailWorker,
  getScheduledMailRateLimitDelay,
} from "../src/main/mail/scheduled-mail-worker";
import type {
  ClaimedScheduledMail,
  RecoverableScheduledMail,
  ScheduledMailAttentionReason,
  ScheduledMailDeliveryFailure,
  ScheduledMailNotification,
  ScheduledMailWorkerDependencies,
  ScheduledMailWorkerStore,
} from "../src/main/mail/scheduled-mail-worker";

type Status = "attention" | "preparing" | "scheduled" | "sending" | "sent";

interface FakeClock {
  readonly advance: (milliseconds: number) => void;
  readonly now: number;
  readonly schedule: ScheduledMailWorkerDependencies["schedule"];
  readonly scheduledDelays: number[];
}

const makeFakeClock = (): FakeClock => {
  let now = 1000;
  const scheduledDelays: number[] = [];
  return {
    advance: (milliseconds) => {
      now += milliseconds;
    },
    get now() {
      return now;
    },
    schedule: (_run, delayMs) => {
      scheduledDelays.push(delayMs);
      return { cancel: vi.fn<() => void>() };
    },
    scheduledDelays,
  };
};

class FakeStore implements ScheduledMailWorkerStore {
  attachments: readonly StoredMailDraftAttachment[] = [];
  readonly key = { accountId: "one@example.com", draftId: "draft-1" };
  attentionReason: ScheduledMailAttentionReason | undefined;
  attemptCount = 0;
  attemptId: string | undefined;
  claimCount = 0;
  lastAttemptAt: number | undefined;
  nextAttemptAt: number | undefined;
  rateLimitStartedAt: number | undefined;
  readonly rfcMessageId = "<stable@scheduled.kisa.invalid>";
  status: Status;

  constructor(status: Status = "scheduled", nextAttemptAt = 1000) {
    this.status = status;
    this.nextAttemptAt = status === "scheduled" ? nextAttemptAt : undefined;
    this.attemptId = status === "sending" ? "crashed-attempt" : undefined;
  }

  async claimDue(
    now: number,
    attemptId: string
  ): Promise<ClaimedScheduledMail | undefined> {
    await Promise.resolve();
    if (
      this.status !== "scheduled" ||
      this.nextAttemptAt === undefined ||
      this.nextAttemptAt > now
    ) {
      return;
    }
    this.claimCount += 1;
    this.status = "preparing";
    this.attemptId = attemptId;
    this.nextAttemptAt = undefined;
    return {
      ...this.key,
      attachments: this.attachments,
      attemptCount: this.attemptCount,
      attemptId,
      bcc: [],
      body: { html: "<p>Hello</p>", text: "Hello" },
      cc: [],
      isMessageValid: true,
      rateLimitStartedAt: this.rateLimitStartedAt,
      rfcMessageId: this.rfcMessageId,
      scheduledAt: 1000,
      subject: "Subject",
      to: ["to@example.com"],
    };
  }

  getNextAttemptAt(): Promise<number | undefined> {
    return Promise.resolve(this.nextAttemptAt);
  }

  listSending(): Promise<readonly RecoverableScheduledMail[]> {
    return Promise.resolve(
      this.status === "sending"
        ? [{ ...this.key, rfcMessageId: this.rfcMessageId }]
        : []
    );
  }

  markAttention(
    _item: typeof this.key,
    attemptId: string | undefined,
    reason: ScheduledMailAttentionReason,
    _now: number
  ): Promise<boolean> {
    if (
      (this.status !== "preparing" && this.status !== "sending") ||
      (attemptId !== undefined && attemptId !== this.attemptId)
    ) {
      return Promise.resolve(false);
    }
    this.status = "attention";
    this.attemptId = undefined;
    this.attentionReason = reason;
    this.nextAttemptAt = undefined;
    return Promise.resolve(true);
  }

  markSent(
    _item: typeof this.key,
    attemptId: string | undefined,
    _now: number
  ): Promise<boolean> {
    if (
      this.status !== "sending" ||
      (attemptId !== undefined && attemptId !== this.attemptId)
    ) {
      return Promise.resolve(false);
    }
    this.status = "sent";
    this.attemptId = undefined;
    return Promise.resolve(true);
  }

  markSending(
    _item: typeof this.key,
    attemptId: string,
    now: number
  ): Promise<boolean> {
    if (this.status !== "preparing" || attemptId !== this.attemptId) {
      return Promise.resolve(false);
    }
    this.status = "sending";
    this.attemptCount += 1;
    this.lastAttemptAt = now;
    return Promise.resolve(true);
  }

  releasePreparation(
    _item: typeof this.key,
    attemptId: string,
    nextAttemptAt: number,
    _now: number
  ): Promise<boolean> {
    if (this.status !== "preparing" || attemptId !== this.attemptId) {
      return Promise.resolve(false);
    }
    this.status = "scheduled";
    this.attemptId = undefined;
    this.nextAttemptAt = nextAttemptAt;
    return Promise.resolve(true);
  }

  resetPreparing(_now: number): Promise<void> {
    if (this.status === "preparing") {
      this.status = "scheduled";
      this.attemptId = undefined;
      this.nextAttemptAt = 1000;
    }
    return Promise.resolve();
  }

  retryAfterRateLimit(
    item: ClaimedScheduledMail,
    nextAttemptAt: number,
    rateLimitStartedAt: number,
    _now: number
  ): Promise<boolean> {
    if (this.status !== "sending" || item.attemptId !== this.attemptId) {
      return Promise.resolve(false);
    }
    this.status = "scheduled";
    this.attemptId = undefined;
    this.nextAttemptAt = nextAttemptAt;
    this.rateLimitStartedAt = rateLimitStartedAt;
    return Promise.resolve(true);
  }
}

interface WorkerHarness {
  readonly clock: FakeClock;
  readonly deliver: ReturnType<
    typeof vi.fn<ScheduledMailWorkerDependencies["deliver"]>
  >;
  readonly notifications: ScheduledMailNotification[];
  readonly worker: ScheduledMailWorker;
}

const makeHarness = (
  store: FakeStore,
  overrides: Partial<ScheduledMailWorkerDependencies> = {}
): WorkerHarness => {
  const clock = makeFakeClock();
  const notifications: ScheduledMailNotification[] = [];
  const deliver = vi.fn<ScheduledMailWorkerDependencies["deliver"]>(() =>
    Promise.resolve({ ok: true })
  );
  const dependencies: ScheduledMailWorkerDependencies = {
    deliver,
    isOnline: () => true,
    loadAttachments: () => Promise.resolve([]),
    notify: (notification) => {
      notifications.push(notification);
      return Promise.resolve();
    },
    now: () => clock.now,
    randomId: () => `attempt-${store.claimCount + 1}`,
    reconcile: () => Promise.resolve({ kind: "missing" }),
    runAccountWork: (_accountId, work, parentSignal) => work(parentSignal),
    schedule: clock.schedule,
    withKeyLock: (_key, run) => run(),
    ...overrides,
  };
  return {
    clock,
    deliver,
    notifications,
    worker: new ScheduledMailWorker(store, dependencies),
  };
};

describe(ScheduledMailWorker, () => {
  it("uses 1, 2, 4, 8, 16, 32, then capped 60 minute rate-limit delays", () => {
    expect(
      Array.from({ length: 8 }, (_, attemptCount) =>
        getScheduledMailRateLimitDelay(attemptCount)
      )
    ).toStrictEqual(
      [1, 2, 4, 8, 16, 32, 60, 60].map((minutes) => minutes * 60_000)
    );
  });

  it("does not arm a poll timer after all scheduled work is finished", async () => {
    const store = new FakeStore();
    const harness = makeHarness(store);

    await harness.worker.start();

    expect(store.status).toBe("sent");
    expect(harness.clock.scheduledDelays).toStrictEqual([]);
    await harness.worker.stop();
  });

  it("claims and delivers a due item exactly once across concurrent wakes", async () => {
    const store = new FakeStore();
    const harness = makeHarness(store);

    await Promise.all([harness.worker.start(), harness.worker.wake()]);
    await harness.worker.wake();

    expect(store.claimCount).toBe(1);
    expect(store.attemptCount).toBe(1);
    expect(harness.deliver).toHaveBeenCalledOnce();
    expect(store.status).toBe("sent");
    await harness.worker.stop();
  });

  it("runs an immediate follow-up cycle when woken after the last claim", async () => {
    const store = new FakeStore();
    const firstClaimStarted = Promise.withResolvers<true>();
    const releaseFirstClaim = Promise.withResolvers<true>();
    const claimDue = store.claimDue.bind(store);
    let claimCallCount = 0;
    store.claimDue = async (now, attemptId) => {
      claimCallCount += 1;
      if (claimCallCount === 1) {
        firstClaimStarted.resolve(true);
        await releaseFirstClaim.promise;
        return;
      }
      return claimDue(now, attemptId);
    };
    const harness = makeHarness(store);

    const start = harness.worker.start();
    await firstClaimStarted.promise;
    const racedWake = harness.worker.wake();
    releaseFirstClaim.resolve(true);
    await Promise.all([start, racedWake]);

    expect(claimCallCount).toBe(3);
    expect(store.claimCount).toBe(1);
    expect(harness.deliver).toHaveBeenCalledOnce();
    expect(store.status).toBe("sent");
    expect(harness.clock.scheduledDelays).toStrictEqual([]);
    await harness.worker.stop();
  });

  it("releases an offline claim without consuming a Gmail attempt", async () => {
    const store = new FakeStore();
    const harness = makeHarness(store, { isOnline: () => false });

    await harness.worker.start();

    expect(harness.deliver).not.toHaveBeenCalled();
    expect(store).toMatchObject({
      attemptCount: 0,
      lastAttemptAt: undefined,
      nextAttemptAt: harness.clock.now + SCHEDULED_MAIL_POLL_INTERVAL_MS,
      status: "scheduled",
    });
    await harness.worker.stop();
  });

  it("honors Retry-After and stops at the 24-hour rate-limit boundary", async () => {
    const store = new FakeStore();
    const rateLimited = vi.fn<ScheduledMailWorkerDependencies["deliver"]>(() =>
      Promise.resolve({
        error: { kind: "rate-limited", retryAfterMs: 5 * 60_000 },
        ok: false,
      })
    );
    const harness = makeHarness(store, { deliver: rateLimited });

    await harness.worker.start();
    expect(store).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: harness.clock.now + 5 * 60_000,
      rateLimitStartedAt: harness.clock.now,
      status: "scheduled",
    });

    harness.clock.advance(SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS);
    await harness.worker.wake();

    expect(rateLimited).toHaveBeenCalledOnce();
    expect(store).toMatchObject({
      attemptCount: 1,
      attentionReason: "rate-limit-exhausted",
      status: "attention",
    });
    await harness.worker.stop();
  });

  it("never retries an unknown send outcome", async () => {
    const store = new FakeStore();
    const unknown: ScheduledMailDeliveryFailure = { kind: "outcome-unknown" };
    const deliver = vi.fn<ScheduledMailWorkerDependencies["deliver"]>(() =>
      Promise.resolve({ error: unknown, ok: false })
    );
    const harness = makeHarness(store, { deliver });

    await harness.worker.start();
    harness.clock.advance(SCHEDULED_MAIL_RATE_LIMIT_WINDOW_MS);
    await harness.worker.wake();

    expect(deliver).toHaveBeenCalledOnce();
    expect(store).toMatchObject({
      attentionReason: "outcome-unknown",
      status: "attention",
    });
    expect(harness.notifications).toStrictEqual([
      { ...store.key, kind: "attention" },
    ]);
    await harness.worker.stop();
  });

  it.each([
    {
      expectedReason: undefined,
      expectedStatus: "sent" as const,
      reconciliation: {
        kind: "found" as const,
      },
    },
    {
      expectedReason: "outcome-unknown" as const,
      expectedStatus: "attention" as const,
      reconciliation: { kind: "missing" as const },
    },
  ])(
    "reconciles a stale sending row to $expectedStatus with its stable Message-ID",
    async ({ expectedReason, expectedStatus, reconciliation }) => {
      const store = new FakeStore("sending");
      const reconcile = vi.fn<ScheduledMailWorkerDependencies["reconcile"]>(
        () => Promise.resolve(reconciliation)
      );
      const harness = makeHarness(store, { reconcile });

      await harness.worker.start();

      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({ rfcMessageId: store.rfcMessageId }),
        expect.any(AbortSignal)
      );
      expect(store.status).toBe(expectedStatus);
      expect(store.attentionReason).toBe(expectedReason);
      expect(harness.deliver).not.toHaveBeenCalled();
      await harness.worker.stop();
    }
  );

  it("keeps the recovery transition and notification inside account supervision", async () => {
    const store = new FakeStore("sending");
    const notificationStarted = Promise.withResolvers<true>();
    const releaseNotification = Promise.withResolvers<true>();
    let supervisedWorkCompleted = false;
    const harness = makeHarness(store, {
      notify: async () => {
        notificationStarted.resolve(true);
        await releaseNotification.promise;
      },
      reconcile: () =>
        Promise.resolve({
          kind: "found" as const,
        }),
      runAccountWork: async (_accountId, work, parentSignal) => {
        await work(parentSignal);
        supervisedWorkCompleted = true;
      },
    });

    const start = harness.worker.start();
    await notificationStarted.promise;
    expect(store.status).toBe("sent");
    expect(supervisedWorkCompleted).toBeFalsy();

    releaseNotification.resolve(true);
    await start;
    expect(supervisedWorkCompleted).toBeTruthy();
    await harness.worker.stop();
  });

  it("defers a failed reconciliation lookup without changing durable outcome", async () => {
    const store = new FakeStore("sending");
    const reconcile = vi.fn<ScheduledMailWorkerDependencies["reconcile"]>(() =>
      Promise.resolve({
        kind: "defer",
        retryAfterMs: 5 * 60_000,
      })
    );
    const harness = makeHarness(store, { reconcile });

    await harness.worker.start();
    harness.clock.advance(SCHEDULED_MAIL_POLL_INTERVAL_MS);
    await harness.worker.wake();

    expect(reconcile).toHaveBeenCalledOnce();
    expect(store.status).toBe("sending");
    expect(store.attentionReason).toBeUndefined();
    expect(harness.notifications).toStrictEqual([]);
    await harness.worker.stop();
  });

  it("fails stored-invalid content before attachment loading or Gmail", async () => {
    const store = new FakeStore();
    const originalClaimDue = store.claimDue.bind(store);
    store.claimDue = async (now, attemptId) => {
      const item = await originalClaimDue(now, attemptId);
      return item === undefined
        ? undefined
        : { ...item, isMessageValid: false };
    };
    const loadAttachments = vi.fn<
      ScheduledMailWorkerDependencies["loadAttachments"]
    >(() => Promise.resolve([]));
    const harness = makeHarness(store, { loadAttachments });

    await harness.worker.start();

    expect(loadAttachments).not.toHaveBeenCalled();
    expect(harness.deliver).not.toHaveBeenCalled();
    expect(store).toMatchObject({
      attemptCount: 0,
      attentionReason: "message-invalid",
      status: "attention",
    });
    await harness.worker.stop();
  });

  it("rejects oversized stored attachments before opening files or calling Gmail", async () => {
    const store = new FakeStore();
    store.attachments = [1, 2, 3].map((index) => ({
      authorizationVersion: 1,
      birthtimeMs: 1,
      device: "1",
      filename: `oversized-${index}.bin`,
      id: `oversized-${index}`,
      inode: `${index}`,
      mediaType: "application/octet-stream",
      mtimeMs: 1,
      path: `/path-that-must-not-be-opened/${index}`,
      size: 10_000_000,
      storage: "app-owned" as const,
    }));
    const harness = makeHarness(store, {
      loadAttachments: loadScheduledAttachments,
    });

    await harness.worker.start();

    expect(harness.deliver).not.toHaveBeenCalled();
    expect(store).toMatchObject({
      attemptCount: 0,
      attentionReason: "attachment-too-large",
      status: "attention",
    });
    await harness.worker.stop();
  });

  it.each([
    "attachment-missing",
    "attachment-invalid",
    "attachment-changed",
    "attachment-too-large",
  ] as const)(
    "moves %s preparation failures to attention without dispatching to Gmail",
    async (reason) => {
      const store = new FakeStore();
      const harness = makeHarness(store, {
        loadAttachments: () =>
          Promise.reject(scheduledMailAttachmentError(reason)),
      });

      await harness.worker.start();

      expect(harness.deliver).not.toHaveBeenCalled();
      expect(store).toMatchObject({
        attemptCount: 0,
        attentionReason: reason,
        status: "attention",
      });
      await harness.worker.stop();
    }
  );

  it("releases a claim when account suspension skips the supervised work", async () => {
    const store = new FakeStore();
    const harness = makeHarness(store, {
      runAccountWork: () => Promise.resolve(),
    });

    await harness.worker.start();

    expect(harness.deliver).not.toHaveBeenCalled();
    expect(store).toMatchObject({
      attemptCount: 0,
      lastAttemptAt: undefined,
      status: "scheduled",
    });
    await harness.worker.stop();
  });

  it("defers stale-send reconciliation while offline", async () => {
    const store = new FakeStore("sending");
    const reconcile = vi.fn<ScheduledMailWorkerDependencies["reconcile"]>(() =>
      Promise.resolve({ kind: "missing" })
    );
    const harness = makeHarness(store, {
      isOnline: () => false,
      reconcile,
    });

    await harness.worker.start();

    expect(reconcile).not.toHaveBeenCalled();
    expect(store.status).toBe("sending");
    expect(harness.notifications).toStrictEqual([]);
    await harness.worker.stop();
  });

  it("does not enter sending when shutdown aborts attachment preparation", async () => {
    const store = new FakeStore();
    const loading = Promise.withResolvers<readonly OutgoingAttachment[]>();
    const started = Promise.withResolvers<null>();
    const harness = makeHarness(store, {
      loadAttachments: () => {
        started.resolve(null);
        return loading.promise;
      },
    });

    const start = harness.worker.start();
    await started.promise;
    const stop = harness.worker.stop();
    loading.resolve([]);
    await Promise.all([start, stop]);

    expect(harness.deliver).not.toHaveBeenCalled();
    expect(store.attemptCount).toBe(0);
    expect(store.status).toBe("scheduled");
  });

  it("records an aborted in-flight dispatch as unknown and never restarts", async () => {
    const store = new FakeStore();
    const started = Promise.withResolvers<null>();
    const outcome =
      Promise.withResolvers<
        Awaited<ReturnType<ScheduledMailWorkerDependencies["deliver"]>>
      >();
    const deliver = vi.fn<ScheduledMailWorkerDependencies["deliver"]>(
      (_item, _attachments, signal) => {
        started.resolve(null);
        signal.addEventListener(
          "abort",
          () =>
            outcome.resolve({
              error: { kind: "outcome-unknown" },
              ok: false,
            }),
          { once: true }
        );
        return outcome.promise;
      }
    );
    const harness = makeHarness(store, { deliver });

    const start = harness.worker.start();
    await started.promise;
    await harness.worker.stop();
    await start;
    harness.clock.advance(SCHEDULED_MAIL_POLL_INTERVAL_MS);
    await harness.worker.wake();

    expect(deliver).toHaveBeenCalledOnce();
    expect(store).toMatchObject({
      attemptCount: 1,
      attentionReason: "outcome-unknown",
      status: "attention",
    });
  });
});
