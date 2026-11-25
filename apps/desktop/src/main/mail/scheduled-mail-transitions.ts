import type {
  ScheduledMessageAttentionReason,
  ScheduledMessageStatus,
} from "@repo/database/schemas";

interface ScheduledMailTransition {
  /** The statuses the email may be in for this change to apply. */
  readonly from: readonly ScheduledMessageStatus[];
  /** Where it leaves the email. Descriptive: the statement sets the status. */
  readonly to: ScheduledMessageStatus | "deleted" | "unchanged";
}

/**
 * Every way the worker or the user changes a stored email's delivery status,
 * and from where. Each of those statements takes its `WHERE` statuses from
 * here and its new values from `entered`. The statements keep their own
 * attempt, revision and account guards: those decide which of two racing
 * writers wins, which the table does not.
 *
 * Three changes have no source status to guard and so no row: scheduling
 * creates the email as `scheduled`, removing an account deletes its emails
 * whatever their status, and a `sent` email is deleted once its outcome has
 * been shown.
 *
 * No user action applies to an email the worker has claimed (`preparing`):
 * the list already shows it as being sent.
 */
export const SCHEDULED_MAIL_TRANSITIONS = {
  // The worker.
  claim: { from: ["scheduled"], to: "preparing" },
  "mark-attention": { from: ["preparing", "sending"], to: "attention" },
  "mark-sending": { from: ["preparing"], to: "sending" },
  "mark-sent": { from: ["sending"], to: "sent" },
  /** After a restart, for a send that no longer has a live attempt. */
  "reconcile-attention": { from: ["sending"], to: "attention" },
  "release-preparation": { from: ["preparing"], to: "scheduled" },
  /** At startup: no send had begun, so the email simply waits again. */
  "reset-preparing": { from: ["preparing"], to: "scheduled" },
  "retry-after-rate-limit": { from: ["sending"], to: "scheduled" },

  // The user, in the editor.
  "edit-begin": { from: ["scheduled", "attention"], to: "unchanged" },
  "edit-discard": { from: ["scheduled", "attention"], to: "deleted" },
  "edit-reschedule": { from: ["scheduled", "attention"], to: "scheduled" },
  "edit-save": { from: ["scheduled", "attention"], to: "unchanged" },
  "edit-send-now": { from: ["scheduled", "attention"], to: "scheduled" },

  // The user, from the list row.
  "row-cancel": { from: ["scheduled", "attention"], to: "deleted" },
  "row-discard": { from: ["scheduled", "attention"], to: "deleted" },
  "row-send-now": { from: ["scheduled", "attention"], to: "scheduled" },
} as const satisfies Record<string, ScheduledMailTransition>;

export type ScheduledMailTransitionName =
  keyof typeof SCHEDULED_MAIL_TRANSITIONS;

export const getScheduledMailSourceStatuses = (
  name: ScheduledMailTransitionName
): readonly ScheduledMessageStatus[] => SCHEDULED_MAIL_TRANSITIONS[name].from;

/**
 * Why the user's action cannot apply to the email as it is stored. A sent
 * email is gone as far as the user is concerned; its row only waits for its
 * notification.
 */
export const getScheduledMailActionRefusal = (
  name: ScheduledMailTransitionName,
  status: ScheduledMessageStatus | undefined
): "being-sent" | "gone" | undefined => {
  if (status === undefined || status === "sent") {
    return "gone";
  }

  return getScheduledMailSourceStatuses(name).includes(status)
    ? undefined
    : "being-sent";
};

/** A terminal outcome that has not been announced to the user yet. */
const UNANNOUNCED = {
  notificationClaimId: null,
  notificationClaimedAt: null,
  notifiedAt: null,
} as const;

/**
 * The columns that say which status a row is in, as one value per status.
 * The table's checks tie `attemptId`, `nextAttemptAt` and `attentionReason`
 * to the status, and allow a notification only on a terminal one.
 */
export const entered = {
  attention: (reason: ScheduledMessageAttentionReason) =>
    ({
      ...UNANNOUNCED,
      attemptId: null,
      attentionReason: reason,
      nextAttemptAt: null,
      status: "attention",
    }) as const,
  preparing: (attemptId: string) =>
    ({
      attemptId,
      attentionReason: null,
      nextAttemptAt: null,
      status: "preparing",
    }) as const,
  /** `nextAttemptAt` may be a time or the SQL that computes one. */
  scheduled: <NextAttemptAt>(nextAttemptAt: NextAttemptAt) =>
    ({
      ...UNANNOUNCED,
      attemptId: null,
      attentionReason: null,
      nextAttemptAt,
      status: "scheduled",
    }) as const,
  /** Keeps the attempt that prepared it. */
  sending: () =>
    ({
      attentionReason: null,
      nextAttemptAt: null,
      status: "sending",
    }) as const,
  sent: () =>
    ({
      ...UNANNOUNCED,
      attemptId: null,
      attentionReason: null,
      nextAttemptAt: null,
      status: "sent",
    }) as const,
};

/** Delivery starting over at the user's request: earlier attempts are void. */
export const RESTARTED_DELIVERY = {
  attemptCount: 0,
  lastAttemptAt: null,
  rateLimitStartedAt: null,
} as const;
