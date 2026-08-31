import { randomUUID } from "node:crypto";

import { mailDrafts, scheduledMessages } from "@repo/database/schemas";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { app, Notification } from "electron";
import type { BrowserWindow } from "electron";

import { SCHEDULED_MAIL_OUTCOME_CHANNEL } from "../../shared/ipc/channels";
import { ScheduledMailOutcome } from "../../shared/ipc/scheduled-mail";
import { sendRendererEvent } from "../electron/renderer-events";
import { createWindow, getMainWindow } from "../window/create-window";
import {
  bestEffortDraftAttachmentCleanup,
  getOptionalDraftAttachmentStore,
} from "./draft-attachment-store";
import { decodeStoredOutgoingAttachmentsStrict } from "./outgoing-attachment-files";
import {
  accountOwnsScheduledDraft,
  withScheduledMailDatabase,
} from "./scheduled-mail-database";
import { scheduledMailError } from "./scheduled-mail-error";
import type { ScheduledMailNotification } from "./scheduled-mail-worker";

const claimNotification = Effect.fn("claimScheduledMailNotification")(
  function* claimNotification(
    notification: ScheduledMailNotification,
    now: number
  ) {
    return yield* withScheduledMailDatabase(async (database) => {
      const claimId = randomUUID();
      const rows = await database
        .update(scheduledMessages)
        .set({ notificationClaimId: claimId, notificationClaimedAt: now })
        .where(
          and(
            eq(scheduledMessages.draftId, notification.draftId),
            eq(scheduledMessages.status, notification.kind),
            isNull(scheduledMessages.notificationClaimId),
            isNull(scheduledMessages.notificationClaimedAt),
            isNull(scheduledMessages.notifiedAt),
            accountOwnsScheduledDraft(notification)
          )
        )
        .returning({ draftId: scheduledMessages.draftId })
        .all();
      return rows.length === 1 ? claimId : undefined;
    });
  }
);

const completeNotification = Effect.fn("completeScheduledMailNotification")(
  function* completeNotification(
    notification: ScheduledMailNotification,
    claimId: string,
    now: number
  ) {
    const attachments = yield* withScheduledMailDatabase((database) =>
      database.transaction(async (transaction) => {
        await transaction
          .update(scheduledMessages)
          .set({ notifiedAt: now })
          .where(
            and(
              eq(scheduledMessages.draftId, notification.draftId),
              eq(scheduledMessages.notificationClaimId, claimId),
              accountOwnsScheduledDraft(notification)
            )
          )
          .run();
        if (notification.kind !== "sent") {
          return [];
        }
        const draft = await transaction.query.mailDrafts.findFirst({
          columns: { attachments: true },
          where: {
            accountEmail: notification.accountId,
            id: notification.draftId,
          },
        });
        await transaction
          .delete(mailDrafts)
          .where(
            and(
              eq(mailDrafts.id, notification.draftId),
              eq(mailDrafts.accountEmail, notification.accountId)
            )
          )
          .run();
        return decodeStoredOutgoingAttachmentsStrict(draft?.attachments) ?? [];
      })
    );
    const store = getOptionalDraftAttachmentStore();
    if (store !== undefined) {
      yield* bestEffortDraftAttachmentCleanup(store.delete(attachments));
      yield* bestEffortDraftAttachmentCleanup(
        store.deleteDraft(notification.draftId)
      );
    }
  }
);

const releaseNotificationClaim = Effect.fn(
  "releaseScheduledMailNotificationClaim"
)(function* releaseNotificationClaim(
  notification: ScheduledMailNotification,
  claimId: string
) {
  yield* withScheduledMailDatabase(async (database) => {
    await database
      .update(scheduledMessages)
      .set({ notificationClaimId: null, notificationClaimedAt: null })
      .where(
        and(
          eq(scheduledMessages.draftId, notification.draftId),
          eq(scheduledMessages.notificationClaimId, claimId),
          isNull(scheduledMessages.notifiedAt),
          accountOwnsScheduledDraft(notification)
        )
      )
      .run();
  });
});

const activeScheduledNotifications = new Map<
  Notification,
  Pick<ScheduledMailNotification, "accountId" | "draftId">
>();

interface ScheduledMailOutcomeTarget {
  readonly id: number;
  readonly isDestroyed: () => boolean;
  readonly isLoadingMainFrame: () => boolean;
  readonly on: (event: "did-start-loading", listener: () => void) => unknown;
  readonly once: (event: "destroyed", listener: () => void) => unknown;
}

const readyOutcomeTargets = new WeakSet<ScheduledMailOutcomeTarget>();
const trackedOutcomeTargets = new WeakSet<ScheduledMailOutcomeTarget>();
const pendingOpens = new WeakMap<
  ScheduledMailOutcomeTarget,
  Map<string, ScheduledMailNotification>
>();

const outcomeKey = (notification: ScheduledMailNotification): string =>
  `${notification.accountId}\0${notification.draftId}\0${notification.kind}`;

const trackOutcomeTarget = (target: ScheduledMailOutcomeTarget): void => {
  if (trackedOutcomeTargets.has(target)) {
    return;
  }
  trackedOutcomeTargets.add(target);
  target.on("did-start-loading", () => {
    readyOutcomeTargets.delete(target);
  });
  target.once("destroyed", () => {
    readyOutcomeTargets.delete(target);
    pendingOpens.delete(target);
  });
};

const isOutcomeTargetReady = (target: ScheduledMailOutcomeTarget): boolean =>
  readyOutcomeTargets.has(target) &&
  !target.isDestroyed() &&
  !target.isLoadingMainFrame();

const notifyRendererOfScheduledMailOutcome = (
  notification: ScheduledMailNotification,
  intent: "feedback" | "open",
  targetWindow: BrowserWindow
): boolean => {
  if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return false;
  }
  sendRendererEvent(
    SCHEDULED_MAIL_OUTCOME_CHANNEL,
    ScheduledMailOutcome,
    {
      accountId: notification.accountId,
      draftId: notification.draftId,
      intent,
      kind: notification.kind,
    },
    targetWindow
  );
  return true;
};

const flushPendingOpens = (
  target: ScheduledMailOutcomeTarget,
  targetWindow: BrowserWindow
): void => {
  const notifications = pendingOpens.get(target);
  if (notifications === undefined || !isOutcomeTargetReady(target)) {
    return;
  }
  for (const [key, notification] of notifications) {
    if (
      !notifyRendererOfScheduledMailOutcome(notification, "open", targetWindow)
    ) {
      return;
    }
    notifications.delete(key);
  }
  if (notifications.size === 0) {
    pendingOpens.delete(target);
  }
};

const queueScheduledMailOpen = (
  notification: ScheduledMailNotification,
  targetWindow: BrowserWindow
): void => {
  const target = targetWindow.webContents;
  trackOutcomeTarget(target);
  const notifications = pendingOpens.get(target) ?? new Map();
  notifications.set(outcomeKey(notification), notification);
  pendingOpens.set(target, notifications);
  flushPendingOpens(target, targetWindow);
};

const focusMainWindow = (notification: ScheduledMailNotification): void => {
  const window = getMainWindow() ?? createWindow();
  if (window.isDestroyed()) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  app.focus({ steal: true });
  window.focus();
  queueScheduledMailOpen(notification, window);
};

const presentScheduledMailNotification = (
  notification: ScheduledMailNotification
) =>
  Effect.try({
    catch: () => scheduledMailError("Could not show scheduled mail feedback"),
    try: () => {
      const mainWindow = getMainWindow();
      const hasVisibleMainWindow =
        mainWindow !== undefined &&
        !mainWindow.isDestroyed() &&
        mainWindow.isVisible() &&
        !mainWindow.isMinimized();
      if (
        hasVisibleMainWindow &&
        isOutcomeTargetReady(mainWindow.webContents)
      ) {
        return notifyRendererOfScheduledMailOutcome(
          notification,
          "feedback",
          mainWindow
        );
      } else if (Notification.isSupported()) {
        const systemNotification = new Notification({
          body:
            notification.kind === "sent"
              ? "A scheduled email was sent."
              : "Open Kisa to review it.",
          title:
            notification.kind === "sent"
              ? "Scheduled email sent"
              : "Scheduled email needs attention",
        });
        activeScheduledNotifications.set(systemNotification, {
          accountId: notification.accountId,
          draftId: notification.draftId,
        });
        const forgetNotification = (): void => {
          activeScheduledNotifications.delete(systemNotification);
        };
        systemNotification.once("click", () => {
          forgetNotification();
          focusMainWindow(notification);
        });
        systemNotification.once("close", forgetNotification);
        systemNotification.show();
        return true;
      }
      return false;
    },
  });

const showScheduledMailNotificationEffect = Effect.fn(
  "showScheduledMailNotification"
)(function* showScheduledMailNotificationEffect(
  notification: ScheduledMailNotification
) {
  const claimedAt = yield* Clock.currentTimeMillis;
  const claimId = yield* claimNotification(notification, claimedAt);
  if (claimId === undefined) {
    return;
  }
  const delivered = yield* presentScheduledMailNotification(notification).pipe(
    Effect.catch((error) =>
      releaseNotificationClaim(notification, claimId).pipe(
        Effect.andThen(Effect.fail(error))
      )
    )
  );
  if (!delivered) {
    yield* releaseNotificationClaim(notification, claimId);
    return;
  }
  const completedAt = yield* Clock.currentTimeMillis;
  yield* completeNotification(notification, claimId, completedAt);
});

export const showScheduledMailNotification = (
  notification: ScheduledMailNotification
): Promise<void> =>
  Effect.runPromise(showScheduledMailNotificationEffect(notification));

export const closeScheduledMailNotifications = (accountId: string): void => {
  for (const [notification, key] of activeScheduledNotifications) {
    if (key.accountId !== accountId) {
      continue;
    }
    activeScheduledNotifications.delete(notification);
    try {
      notification.close();
    } catch {
      // Account cleanup remains authoritative if the OS already closed it.
    }
  }
};

const releaseStaleScheduledMailNotificationClaimsEffect = Effect.fn(
  "releaseStaleScheduledMailNotificationClaims"
)(function* releaseStaleScheduledMailNotificationClaimsEffect() {
  yield* withScheduledMailDatabase(async (database) => {
    await database
      .update(scheduledMessages)
      .set({ notificationClaimId: null, notificationClaimedAt: null })
      .where(
        and(
          inArray(scheduledMessages.status, ["attention", "sent"]),
          isNotNull(scheduledMessages.notificationClaimId),
          isNull(scheduledMessages.notifiedAt)
        )
      )
      .run();
  });
});

export const releaseStaleScheduledMailNotificationClaims = (): Promise<void> =>
  Effect.runPromise(releaseStaleScheduledMailNotificationClaimsEffect());

const dispatchPendingScheduledMailNotificationsEffect = Effect.fn(
  "dispatchPendingScheduledMailNotifications"
)(function* dispatchPendingScheduledMailNotificationsEffect() {
  const rows = yield* withScheduledMailDatabase((database) =>
    database
      .select({
        accountId: mailDrafts.accountEmail,
        draftId: scheduledMessages.draftId,
        status: scheduledMessages.status,
      })
      .from(scheduledMessages)
      .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
      .where(
        and(
          inArray(scheduledMessages.status, ["attention", "sent"]),
          isNull(scheduledMessages.notificationClaimId),
          isNull(scheduledMessages.notifiedAt),
          isNotNull(mailDrafts.accountEmail)
        )
      )
      .orderBy(asc(scheduledMessages.updatedAt))
      .all()
  );
  yield* Effect.forEach(
    rows,
    (row) =>
      row.accountId === null ||
      (row.status !== "attention" && row.status !== "sent")
        ? Effect.void
        : showScheduledMailNotificationEffect({
            accountId: row.accountId,
            draftId: row.draftId,
            kind: row.status,
          }),
    { concurrency: "unbounded", discard: true }
  );
});

export const dispatchPendingScheduledMailNotifications = (): Promise<void> =>
  Effect.runPromise(dispatchPendingScheduledMailNotificationsEffect());

export const setScheduledMailOutcomeTargetReadyEffect = Effect.fn(
  "setScheduledMailOutcomeTargetReady"
)(function* setScheduledMailOutcomeTargetReadyEffect(
  target: ScheduledMailOutcomeTarget,
  ready: boolean
) {
  const shouldDispatch = yield* Effect.sync(() => {
    trackOutcomeTarget(target);
    if (!ready || target.isDestroyed() || target.isLoadingMainFrame()) {
      readyOutcomeTargets.delete(target);
      return false;
    }
    readyOutcomeTargets.add(target);
    const mainWindow = getMainWindow();
    if (
      mainWindow === undefined ||
      mainWindow.isDestroyed() ||
      mainWindow.webContents !== target
    ) {
      return false;
    }
    flushPendingOpens(target, mainWindow);
    return true;
  });
  if (shouldDispatch) {
    yield* dispatchPendingScheduledMailNotificationsEffect();
  }
});

export const setScheduledMailOutcomeTargetReady = (
  target: ScheduledMailOutcomeTarget,
  ready: boolean
): Promise<void> =>
  Effect.runPromise(setScheduledMailOutcomeTargetReadyEffect(target, ready));
