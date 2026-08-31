import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import type { DatabaseError } from "@repo/database/runtime";
import { mailDrafts, scheduledMessages } from "@repo/database/schemas";
import type { ScheduledMessageAttentionReason } from "@repo/database/schemas";
import {
  and,
  asc,
  count,
  eq,
  getColumns,
  gt,
  inArray,
  isNotNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { Effect, Schema } from "effect";

import {
  hasEmailSignature,
  removeEmailSignature,
} from "../../shared/email-signature";
import { GmailOutgoingSubject } from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database-query";
import { accountMailWorkSupervisor } from "./account-mail-work-supervisor";
import { parseMailbox } from "./gmail-payload";
import { claimFirstAvailableScheduledMail } from "./scheduled-mail-claim-pages";
import { ScheduledMailError, scheduledMailError } from "./scheduled-mail-error";
import type {
  ClaimedScheduledMail,
  RecoverableScheduledMail,
  ScheduledMailKey,
  ScheduledMailWorkerStore,
} from "./scheduled-mail-worker";

export type MailDraftRow = typeof mailDrafts.$inferSelect;
export type ScheduledMessageRow = typeof scheduledMessages.$inferSelect;

export interface JoinedScheduledMessage {
  readonly draft: MailDraftRow;
  readonly schedule: ScheduledMessageRow;
}

const toScheduledMailDatabaseError = (
  error: DatabaseError,
  fallback: string
): ScheduledMailError =>
  error.cause instanceof ScheduledMailError
    ? error.cause
    : scheduledMailError(fallback);

interface ScheduledMailScopeTotals {
  readonly attentionCount: number;
  readonly hasScheduledMail: boolean;
}

interface ScheduledMailDueCursor {
  readonly draftId: string;
  readonly nextAttemptAt: number;
  readonly scheduledAt: number;
}

const isGmailOutgoingSubject = Schema.is(GmailOutgoingSubject);

export const joinedScheduledMessageSelection = {
  draft: getColumns(mailDrafts),
  schedule: getColumns(scheduledMessages),
};

export const withScheduledMailDatabase = <A>(
  run: (database: RemoteDatabaseClient) => Promise<A>,
  message = "Could not update scheduled email"
): Effect.Effect<A, ScheduledMailError> =>
  withDatabaseClient(run).pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- This maps the Effect error channel at the database boundary.
    Effect.mapError((error) => toScheduledMailDatabaseError(error, message))
  );

export const runScheduledMailDatabase = <A>(
  run: (database: RemoteDatabaseClient) => Promise<A>,
  message = "Could not update scheduled email"
): Promise<A> => Effect.runPromise(withScheduledMailDatabase(run, message));

export const accountOwnsScheduledDraft = (key: ScheduledMailKey) =>
  sql<boolean>`exists (
    select 1 from ${mailDrafts}
    where ${mailDrafts.id} = ${key.draftId}
      and ${mailDrafts.accountEmail} = ${key.accountId}
  )`;

export const loadScheduledMessage = async (
  database: RemoteDatabaseClient,
  key: ScheduledMailKey
): Promise<JoinedScheduledMessage | undefined> => {
  const [row] = await database
    .select(joinedScheduledMessageSelection)
    .from(scheduledMessages)
    .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
    .where(
      and(
        eq(scheduledMessages.draftId, key.draftId),
        eq(mailDrafts.accountEmail, key.accountId)
      )
    )
    .limit(1)
    .all();
  return row;
};

export const loadScheduledMailScopeTotals = async (
  database: RemoteDatabaseClient,
  accountIds: readonly string[]
): Promise<ScheduledMailScopeTotals> => {
  if (accountIds.length === 0) {
    return { attentionCount: 0, hasScheduledMail: false };
  }
  const [row] = await database
    .select({
      attentionCount: sql<number>`coalesce(sum(case when ${scheduledMessages.status} = 'attention' then 1 else 0 end), 0)`,
      scheduledCount: count(),
    })
    .from(scheduledMessages)
    .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
    .where(
      and(
        inArray(mailDrafts.accountEmail, [...new Set(accountIds)]),
        ne(scheduledMessages.status, "sent")
      )
    )
    .all();
  return {
    attentionCount: row?.attentionCount ?? 0,
    hasScheduledMail: (row?.scheduledCount ?? 0) > 0,
  };
};

const isStoredMessageValidForDelivery = (
  row: JoinedScheduledMessage
): boolean => {
  const { draft } = row;
  if (
    draft.accountEmail === null ||
    draft.kind !== "new" ||
    draft.messageId !== null ||
    draft.threadId !== null ||
    [...draft.to, ...draft.cc, ...draft.bcc].length === 0 ||
    [...draft.to, ...draft.cc, ...draft.bcc].some(
      (recipient) => parseMailbox(recipient) === undefined
    ) ||
    draft.subject.length === 0 ||
    !isGmailOutgoingSubject(draft.subject) ||
    draft.subject !== draft.subject.trim()
  ) {
    return false;
  }

  const signatureFields = [
    draft.signatureAccountEmail,
    draft.signatureHtml,
    draft.signatureText,
  ];
  const hasNoSignature = signatureFields.every((value) => value === null);
  const hasCompleteSignature = signatureFields.every((value) => value !== null);
  if (!(hasNoSignature || hasCompleteSignature)) {
    return false;
  }

  const body = { html: draft.bodyHtml, text: draft.bodyText };
  if (hasNoSignature) {
    return body.text.trim().length > 0;
  }
  if (
    draft.signatureAccountEmail !== draft.accountEmail ||
    draft.signatureHtml === null ||
    draft.signatureText === null
  ) {
    return false;
  }
  const signature = {
    html: draft.signatureHtml,
    text: draft.signatureText,
  };
  return (
    hasEmailSignature(body, signature) &&
    removeEmailSignature(body, signature).text.trim().length > 0
  );
};

const toClaimedScheduledMail = (
  row: JoinedScheduledMessage,
  attemptId: string
): ClaimedScheduledMail => {
  const claimed: ClaimedScheduledMail = {
    accountId: row.draft.accountEmail ?? "",
    attachments: row.draft.attachments,
    attemptCount: row.schedule.attemptCount,
    attemptId,
    bcc: row.draft.bcc,
    body: { html: row.draft.bodyHtml, text: row.draft.bodyText },
    cc: row.draft.cc,
    draftId: row.draft.id,
    isMessageValid: isStoredMessageValidForDelivery(row),
    rfcMessageId: row.schedule.rfcMessageId,
    scheduledAt: row.schedule.scheduledAt,
    subject: row.draft.subject,
    to: row.draft.to,
  };
  return row.schedule.rateLimitStartedAt === null
    ? claimed
    : { ...claimed, rateLimitStartedAt: row.schedule.rateLimitStartedAt };
};

interface DatabaseScheduledMailWorkerStoreOptions {
  readonly notifyChanged: (
    key: ScheduledMailKey,
    kind: "remove" | "upsert"
  ) => void;
  readonly withKeyLock: <A>(
    key: ScheduledMailKey,
    run: () => Promise<A>
  ) => Promise<A>;
}

/* oxlint-disable eslint/sort-keys -- Port methods follow the durable delivery lifecycle rather than alphabetical order. */
export const makeDatabaseScheduledMailWorkerStore = (
  options: DatabaseScheduledMailWorkerStoreOptions
): ScheduledMailWorkerStore => ({
  claimDue(
    now: number,
    attemptId: string
  ): Promise<ClaimedScheduledMail | undefined> {
    return claimFirstAvailableScheduledMail<
      JoinedScheduledMessage,
      ScheduledMailDueCursor,
      ClaimedScheduledMail
    >({
      // oxlint-disable-next-line eslint/require-await -- The paging port requires an asynchronous claim callback, including the empty-account branch.
      claim: async (row) => {
        const accountId = row.draft.accountEmail;
        if (accountId === null) {
          return;
        }
        const key = { accountId, draftId: row.draft.id };
        // oxlint-disable-next-line eslint/require-await -- Keyed serialization requires a promise-returning callback, including the suspended branch.
        return options.withKeyLock(key, async () => {
          if (accountMailWorkSupervisor.isSuspended(accountId)) {
            return;
          }
          return runScheduledMailDatabase((database) =>
            database.transaction(async (transaction) => {
              const updated = await transaction
                .update(scheduledMessages)
                .set({
                  attemptId,
                  nextAttemptAt: null,
                  revision: row.schedule.revision + 1,
                  status: "preparing",
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(scheduledMessages.draftId, key.draftId),
                    eq(scheduledMessages.status, "scheduled"),
                    eq(scheduledMessages.revision, row.schedule.revision),
                    accountOwnsScheduledDraft(key)
                  )
                )
                .returning({ draftId: scheduledMessages.draftId })
                .all();
              return updated.length === 0
                ? undefined
                : toClaimedScheduledMail(row, attemptId);
            })
          );
        });
      },
      loadPage: (cursor, pageSize) =>
        runScheduledMailDatabase(
          (database) =>
            database
              .select(joinedScheduledMessageSelection)
              .from(scheduledMessages)
              .innerJoin(
                mailDrafts,
                eq(mailDrafts.id, scheduledMessages.draftId)
              )
              .where(
                and(
                  eq(scheduledMessages.status, "scheduled"),
                  lte(scheduledMessages.nextAttemptAt, now),
                  isNotNull(mailDrafts.accountEmail),
                  cursor === undefined
                    ? undefined
                    : or(
                        gt(
                          scheduledMessages.nextAttemptAt,
                          cursor.nextAttemptAt
                        ),
                        and(
                          eq(
                            scheduledMessages.nextAttemptAt,
                            cursor.nextAttemptAt
                          ),
                          gt(scheduledMessages.scheduledAt, cursor.scheduledAt)
                        ),
                        and(
                          eq(
                            scheduledMessages.nextAttemptAt,
                            cursor.nextAttemptAt
                          ),
                          eq(scheduledMessages.scheduledAt, cursor.scheduledAt),
                          gt(scheduledMessages.draftId, cursor.draftId)
                        )
                      )
                )
              )
              .orderBy(
                asc(scheduledMessages.nextAttemptAt),
                asc(scheduledMessages.scheduledAt),
                asc(scheduledMessages.draftId)
              )
              .limit(pageSize)
              .all(),
          "Could not load due scheduled email"
        ),
      toCursor: (row) => {
        if (row.schedule.nextAttemptAt === null) {
          throw scheduledMailError("Scheduled email has an invalid due time");
        }
        return {
          draftId: row.schedule.draftId,
          nextAttemptAt: row.schedule.nextAttemptAt,
          scheduledAt: row.schedule.scheduledAt,
        };
      },
    });
  },

  getNextAttemptAt(): Promise<number | undefined> {
    return runScheduledMailDatabase(async (database) => {
      const [row] = await database
        .select({ nextAttemptAt: scheduledMessages.nextAttemptAt })
        .from(scheduledMessages)
        .where(eq(scheduledMessages.status, "scheduled"))
        .orderBy(asc(scheduledMessages.nextAttemptAt))
        .limit(1)
        .all();
      return row?.nextAttemptAt ?? undefined;
    });
  },

  listSending(): Promise<readonly RecoverableScheduledMail[]> {
    return runScheduledMailDatabase(async (database) => {
      const rows = await database
        .select({
          accountId: mailDrafts.accountEmail,
          draftId: scheduledMessages.draftId,
          rfcMessageId: scheduledMessages.rfcMessageId,
        })
        .from(scheduledMessages)
        .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
        .where(
          and(
            eq(scheduledMessages.status, "sending"),
            isNotNull(mailDrafts.accountEmail)
          )
        )
        .all();
      return rows.flatMap((row) =>
        row.accountId === null
          ? []
          : [
              {
                accountId: row.accountId,
                draftId: row.draftId,
                rfcMessageId: row.rfcMessageId,
              },
            ]
      );
    });
  },

  markSending(
    item: ScheduledMailKey,
    attemptId: string,
    now: number
  ): Promise<boolean> {
    return runScheduledMailDatabase(async (database) => {
      const rows = await database
        .update(scheduledMessages)
        .set({
          attemptCount: sql`${scheduledMessages.attemptCount} + 1`,
          lastAttemptAt: now,
          revision: sql`${scheduledMessages.revision} + 1`,
          status: "sending",
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledMessages.draftId, item.draftId),
            eq(scheduledMessages.status, "preparing"),
            eq(scheduledMessages.attemptId, attemptId),
            accountOwnsScheduledDraft(item)
          )
        )
        .returning({ draftId: scheduledMessages.draftId })
        .all();
      if (rows.length === 1) {
        options.notifyChanged(item, "upsert");
      }
      return rows.length === 1;
    });
  },

  releasePreparation(
    item: ScheduledMailKey,
    attemptId: string,
    nextAttemptAt: number,
    now: number
  ): Promise<boolean> {
    return runScheduledMailDatabase(async (database) => {
      const rows = await database
        .update(scheduledMessages)
        .set({
          attemptId: null,
          nextAttemptAt,
          revision: sql`${scheduledMessages.revision} + 1`,
          status: "scheduled",
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledMessages.draftId, item.draftId),
            eq(scheduledMessages.status, "preparing"),
            eq(scheduledMessages.attemptId, attemptId),
            accountOwnsScheduledDraft(item)
          )
        )
        .returning({ draftId: scheduledMessages.draftId })
        .all();
      return rows.length === 1;
    });
  },

  markAttention(
    item: ScheduledMailKey,
    attemptId: string | undefined,
    reason: ScheduledMessageAttentionReason,
    now: number
  ): Promise<boolean> {
    return runScheduledMailDatabase(async (database) => {
      const attemptPredicate =
        attemptId === undefined
          ? eq(scheduledMessages.status, "sending")
          : and(
              inArray(scheduledMessages.status, ["preparing", "sending"]),
              eq(scheduledMessages.attemptId, attemptId)
            );
      const rows = await database
        .update(scheduledMessages)
        .set({
          attemptId: null,
          attentionReason: reason,
          nextAttemptAt: null,
          notificationClaimId: null,
          notificationClaimedAt: null,
          notifiedAt: null,
          revision: sql`${scheduledMessages.revision} + 1`,
          status: "attention",
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledMessages.draftId, item.draftId),
            attemptPredicate,
            accountOwnsScheduledDraft(item)
          )
        )
        .returning({ draftId: scheduledMessages.draftId })
        .all();
      if (rows.length === 1) {
        options.notifyChanged(item, "upsert");
      }
      return rows.length === 1;
    });
  },

  markSent(
    item: ScheduledMailKey,
    attemptId: string | undefined,
    now: number
  ): Promise<boolean> {
    return runScheduledMailDatabase(async (database) => {
      const attemptPredicate =
        attemptId === undefined
          ? eq(scheduledMessages.status, "sending")
          : and(
              eq(scheduledMessages.status, "sending"),
              eq(scheduledMessages.attemptId, attemptId)
            );
      const rows = await database
        .update(scheduledMessages)
        .set({
          attemptId: null,
          attentionReason: null,
          nextAttemptAt: null,
          notificationClaimId: null,
          notificationClaimedAt: null,
          notifiedAt: null,
          revision: sql`${scheduledMessages.revision} + 1`,
          status: "sent",
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledMessages.draftId, item.draftId),
            attemptPredicate,
            accountOwnsScheduledDraft(item)
          )
        )
        .returning({ draftId: scheduledMessages.draftId })
        .all();
      if (rows.length === 1) {
        options.notifyChanged(item, "remove");
      }
      return rows.length === 1;
    });
  },

  resetPreparing(now: number): Promise<void> {
    return runScheduledMailDatabase(async (database) => {
      await database
        .update(scheduledMessages)
        .set({
          attemptId: null,
          nextAttemptAt: sql`${scheduledMessages.scheduledAt}`,
          revision: sql`${scheduledMessages.revision} + 1`,
          status: "scheduled",
          updatedAt: now,
        })
        .where(eq(scheduledMessages.status, "preparing"))
        .run();
    });
  },

  retryAfterRateLimit(
    item: ClaimedScheduledMail,
    nextAttemptAt: number,
    rateLimitStartedAt: number,
    now: number
  ): Promise<boolean> {
    return runScheduledMailDatabase(async (database) => {
      const rows = await database
        .update(scheduledMessages)
        .set({
          attemptId: null,
          nextAttemptAt,
          rateLimitStartedAt,
          revision: sql`${scheduledMessages.revision} + 1`,
          status: "scheduled",
          updatedAt: now,
        })
        .where(
          and(
            eq(scheduledMessages.draftId, item.draftId),
            eq(scheduledMessages.status, "sending"),
            eq(scheduledMessages.attemptId, item.attemptId),
            accountOwnsScheduledDraft(item)
          )
        )
        .returning({ draftId: scheduledMessages.draftId })
        .all();
      if (rows.length === 1) {
        options.notifyChanged(item, "upsert");
      }
      return rows.length === 1;
    });
  },
});
/* oxlint-enable eslint/sort-keys */
