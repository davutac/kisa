import { randomUUID } from "node:crypto";

import {
  googleAccounts,
  mailDrafts,
  scheduledMessages,
} from "@repo/database/schemas";
import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { and, asc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";
import { powerMonitor } from "electron";

import { SCHEDULED_MAIL_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type { MailDraftInput } from "../../shared/ipc/mail";
import type {
  ScheduledMailAttentionCount,
  ScheduledMailFinishEditResult,
  ScheduledMailFinishEditRequest,
  ScheduledMailKey,
  ScheduledMailPageRequest,
  ScheduledMailScheduleRequest,
  ScheduledMailScope,
  ScheduledMailSendNowRequest,
} from "../../shared/ipc/scheduled-mail";
import {
  SCHEDULED_MAIL_PAGE_SIZE,
  ScheduledMailChanged,
} from "../../shared/ipc/scheduled-mail";
import { withDatabaseClient } from "../database-query";
import { sendRendererEvent } from "../electron/renderer-events";
import type { DraftAttachmentStore } from "./draft-attachment-store";
import {
  bestEffortDraftAttachmentCleanup,
  getOptionalDraftAttachmentStore,
} from "./draft-attachment-store";
import {
  notifyDraftRemoved,
  notifyStoredDraftUpserted,
  toMailDraft,
} from "./mail-drafts";
import {
  OutgoingAttachmentAuthorizationError,
  outgoingAttachmentAuthorizations,
} from "./outgoing-attachment-authorizations";
import { decodeStoredOutgoingAttachmentsStrict } from "./outgoing-attachment-files";
import {
  accountOwnsScheduledDraft,
  joinedScheduledMessageSelection,
  loadScheduledMailScopeTotals,
  loadScheduledMessage,
  withScheduledMailDatabase,
} from "./scheduled-mail-database";
import type { ScheduledMessageRow } from "./scheduled-mail-database";
import { createScheduledMailDelivery } from "./scheduled-mail-delivery";
import {
  toScheduledDraftValues,
  upsertScheduledDraft,
} from "./scheduled-mail-draft-store";
import {
  isValidScheduledDraft,
  normalizeValidScheduledDeliveryDraft,
} from "./scheduled-mail-draft-validation";
import { scheduledMailError } from "./scheduled-mail-error";
import { ScheduledMailKeyedSerial } from "./scheduled-mail-keyed-serial";
import { createScheduledMailLifecycle } from "./scheduled-mail-lifecycle";
import {
  closeScheduledMailNotifications,
  dispatchPendingScheduledMailNotifications,
  releaseStaleScheduledMailNotificationClaims,
} from "./scheduled-mail-notifications";
import { toScheduledMailSummary } from "./scheduled-mail-summary";

const keySerial = new ScheduledMailKeyedSerial();

const notifyScheduledMailChanged = (
  key: ScheduledMailKey,
  kind: "remove" | "upsert"
): void => {
  sendRendererEvent(SCHEDULED_MAIL_CHANGED_CHANNEL, ScheduledMailChanged, {
    accountId: key.accountId,
    draftId: key.draftId,
    kind,
  });
};

const { worker: scheduledMailWorker } = createScheduledMailDelivery({
  notifyChanged: notifyScheduledMailChanged,
  withKeyLock: (key, run) => keySerial.run(key, run),
});

const Cursor = Schema.Struct({
  attentionRank: Schema.Literals([0, 1]),
  draftId: Schema.NonEmptyString,
  scheduledAt: Schema.Int,
});
type Cursor = typeof Cursor.Type;

const attentionRank = sql<0 | 1>`case
  when ${scheduledMessages.status} = 'attention' then 0
  else 1
end`;

const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf-8").toString("base64url");

const decodeCursor = Effect.fn("ScheduledMail.decodeCursor")(
  function* decodeCursor(cursor: string | undefined) {
    if (cursor === undefined) {
      return;
    }
    const parsed = yield* Effect.try({
      catch: () =>
        scheduledMailError("The scheduled email page cursor is invalid"),
      try: (): unknown =>
        JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")),
    });
    return yield* Schema.decodeUnknownEffect(Cursor)(parsed).pipe(
      Effect.mapError(() =>
        scheduledMailError("The scheduled email page cursor is invalid")
      )
    );
  }
);

const adoptDraftAttachments = Effect.fn("adoptDraftAttachments")(
  function* adoptDraftAttachments(
    draftId: string,
    attachments: readonly StoredMailDraftAttachment[]
  ) {
    const store = getOptionalDraftAttachmentStore();
    if (store === undefined) {
      if (attachments.length === 0) {
        return { attachments: [], created: [] };
      }
      return yield* scheduledMailError("Attachment storage is not available");
    }
    return yield* store
      .adopt(draftId, attachments)
      .pipe(Effect.mapError((error) => scheduledMailError(error.message)));
  }
);

const cleanupAdoptedAttachments = (
  run: (store: DraftAttachmentStore) => Effect.Effect<void, unknown>
): Effect.Effect<void> => {
  const store = getOptionalDraftAttachmentStore();
  if (store === undefined) {
    return Effect.void;
  }
  return bestEffortDraftAttachmentCleanup(run(store));
};

const decodeAttachments = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored JSON is strictly decoded at the database boundary.
  input: unknown
): readonly StoredMailDraftAttachment[] =>
  decodeStoredOutgoingAttachmentsStrict(input) ?? [];

export const listScheduledMailPage = Effect.fn("listScheduledMailPage")(
  function* listScheduledMailPage(request: ScheduledMailPageRequest) {
    if (request.accountIds.length === 0) {
      return { items: [] };
    }
    const cursor = yield* decodeCursor(request.cursor);
    const accountIds = [...new Set(request.accountIds)];
    const rows = yield* withScheduledMailDatabase(
      (database) =>
        database
          .select(joinedScheduledMessageSelection)
          .from(scheduledMessages)
          .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
          .where(
            and(
              inArray(mailDrafts.accountEmail, accountIds),
              ne(scheduledMessages.status, "sent"),
              cursor === undefined
                ? undefined
                : or(
                    gt(attentionRank, cursor.attentionRank),
                    and(
                      eq(attentionRank, cursor.attentionRank),
                      or(
                        gt(scheduledMessages.scheduledAt, cursor.scheduledAt),
                        and(
                          eq(scheduledMessages.scheduledAt, cursor.scheduledAt),
                          gt(scheduledMessages.draftId, cursor.draftId)
                        )
                      )
                    )
                  )
            )
          )
          .orderBy(
            asc(attentionRank),
            asc(scheduledMessages.scheduledAt),
            asc(scheduledMessages.draftId)
          )
          .limit(SCHEDULED_MAIL_PAGE_SIZE + 1)
          .all(),
      "Could not load scheduled email"
    );
    const visible = rows.slice(0, SCHEDULED_MAIL_PAGE_SIZE);
    const items = visible.map(toScheduledMailSummary);
    const last = visible.at(-1);
    if (rows.length <= SCHEDULED_MAIL_PAGE_SIZE || last === undefined) {
      return { items };
    }
    return {
      items,
      nextCursor: encodeCursor({
        attentionRank: last.schedule.status === "attention" ? 0 : 1,
        draftId: last.draft.id,
        scheduledAt: last.schedule.scheduledAt,
      }),
    };
  }
);

export const getScheduledMailAttentionCount = Effect.fn(
  "getScheduledMailAttentionCount"
)(function* getScheduledMailAttentionCount(request: ScheduledMailScope) {
  const totals = yield* withScheduledMailDatabase(
    (database) => loadScheduledMailScopeTotals(database, request.accountIds),
    "Could not check scheduled email"
  );
  return {
    count: totals.attentionCount,
    hasScheduledMail: totals.hasScheduledMail,
  } satisfies ScheduledMailAttentionCount;
});

export const scheduleMail = Effect.fn("scheduleMail")(function* scheduleMail(
  request: ScheduledMailScheduleRequest,
  ownerWebContentsId: number
) {
  const now = yield* Clock.currentTimeMillis;
  if (request.scheduledAt <= now) {
    return yield* scheduledMailError(
      "Choose a future time for this scheduled email"
    );
  }
  const draft = yield* normalizeValidScheduledDeliveryDraft(
    request,
    request.draft
  );
  const storedAttachments = yield* Effect.try({
    catch: (error) =>
      error instanceof OutgoingAttachmentAuthorizationError
        ? scheduledMailError(error.message)
        : scheduledMailError("Could not schedule email"),
    try: () =>
      outgoingAttachmentAuthorizations.serializeDraftAttachments(
        ownerWebContentsId,
        draft.attachments
      ),
  });
  const adoption = yield* adoptDraftAttachments(
    request.draftId,
    storedAttachments
  );
  const result = yield* keySerial
    .runEffect(
      request,
      withScheduledMailDatabase(async (database) => {
        let previousAttachments: readonly StoredMailDraftAttachment[] = [];
        await database.transaction(async (transaction) => {
          const [account] = await transaction
            .select({ email: googleAccounts.email })
            .from(googleAccounts)
            .where(eq(googleAccounts.email, request.accountId))
            .limit(1)
            .all();
          if (account === undefined) {
            throw scheduledMailError(
              "The Google account is no longer connected"
            );
          }
          const existingSchedule =
            await transaction.query.scheduledMessages.findFirst({
              where: { draftId: request.draftId },
            });
          if (existingSchedule !== undefined) {
            throw scheduledMailError("This email is already scheduled");
          }
          const existingDraft = await transaction.query.mailDrafts.findFirst({
            where: { id: request.draftId },
          });
          if (
            existingDraft !== undefined &&
            existingDraft.accountEmail !== request.accountId
          ) {
            throw scheduledMailError("This draft belongs to another account");
          }
          previousAttachments = decodeAttachments(existingDraft?.attachments);
          const values = toScheduledDraftValues(
            draft,
            adoption.attachments,
            existingDraft?.createdAt ?? now,
            now
          );
          await upsertScheduledDraft(transaction, values);
          await transaction
            .insert(scheduledMessages)
            .values({
              attemptCount: 0,
              createdAt: now,
              draftId: request.draftId,
              nextAttemptAt: request.scheduledAt,
              revision: 1,
              rfcMessageId: `<${randomUUID()}@scheduled.kisa.invalid>`,
              scheduledAt: request.scheduledAt,
              status: "scheduled",
              updatedAt: now,
            })
            .run();
        });

        const saved = await loadScheduledMessage(database, request);
        if (saved === undefined) {
          throw scheduledMailError("Could not load the scheduled email");
        }
        return { previousAttachments, row: saved };
      }, "Could not schedule email")
    )
    .pipe(
      Effect.catch((error) =>
        cleanupAdoptedAttachments((store) =>
          store.delete(adoption.created)
        ).pipe(Effect.andThen(Effect.fail(error)))
      )
    );
  yield* cleanupAdoptedAttachments((store) =>
    store.deleteNotRetained(result.previousAttachments, adoption.attachments)
  );
  notifyDraftRemoved(request.draftId, request.accountId);
  notifyScheduledMailChanged(request, "upsert");
  void scheduledMailWorker.wake();
  return toScheduledMailSummary(result.row);
});

export const beginScheduledMailEdit = Effect.fn("beginScheduledMailEdit")(
  function* beginScheduledMailEdit(
    request: ScheduledMailKey,
    attachmentOwnerId: number
  ) {
    return yield* keySerial.runEffect(
      request,
      Effect.gen(function* loadEditSession() {
        const row = yield* withScheduledMailDatabase(
          (database) => loadScheduledMessage(database, request),
          "Could not open scheduled email"
        );
        if (row === undefined || row.schedule.status === "sent") {
          return yield* scheduledMailError(
            "The scheduled email no longer exists"
          );
        }
        if (
          row.schedule.status === "preparing" ||
          row.schedule.status === "sending"
        ) {
          return yield* scheduledMailError(
            "The scheduled email is already being sent"
          );
        }
        return {
          draft: toMailDraft(row.draft, attachmentOwnerId),
          item: toScheduledMailSummary(row),
        };
      })
    );
  }
);

const actionDraft = (
  action: ScheduledMailFinishEditRequest["action"]
): MailDraftInput | undefined => ("draft" in action ? action.draft : undefined);

const assertPossibleDuplicateAcknowledged = (
  schedule: ScheduledMessageRow,
  allowPossibleDuplicate: boolean
): void => {
  if (
    schedule.status === "attention" &&
    schedule.attentionReason === "outcome-unknown" &&
    !allowPossibleDuplicate
  ) {
    throw scheduledMailError(
      "Gmail may already have sent this email. Confirm the possible duplicate before sending it again."
    );
  }
};

const getEditedScheduledAt = (
  action: ScheduledMailFinishEditRequest["action"],
  currentScheduledAt: number,
  now: number
): number => {
  if (action.kind === "reschedule") {
    return action.scheduledAt;
  }
  return action.kind === "send-now" ? now : currentScheduledAt;
};

export const finishScheduledMailEdit = Effect.fn("finishScheduledMailEdit")(
  function* finishScheduledMailEdit(
    request: ScheduledMailFinishEditRequest,
    attachmentOwnerId: number
  ) {
    let draft = actionDraft(request.action);
    if (draft !== undefined && !isValidScheduledDraft(request, draft)) {
      return yield* scheduledMailError(
        "The edited draft does not match its scheduled email"
      );
    }
    if (
      draft !== undefined &&
      (request.action.kind === "save" ||
        request.action.kind === "reschedule" ||
        request.action.kind === "send-now")
    ) {
      const editedDraft = draft;
      draft = yield* normalizeValidScheduledDeliveryDraft(request, editedDraft);
    }
    const now = yield* Clock.currentTimeMillis;
    if (
      request.action.kind === "reschedule" &&
      request.action.scheduledAt <= now
    ) {
      return yield* scheduledMailError(
        "Choose a future time for this scheduled email"
      );
    }
    const serializedAttachments =
      draft === undefined
        ? undefined
        : yield* Effect.try({
            catch: (error) =>
              error instanceof OutgoingAttachmentAuthorizationError
                ? scheduledMailError(error.message)
                : scheduledMailError("Could not update scheduled email"),
            try: () =>
              outgoingAttachmentAuthorizations.serializeDraftAttachments(
                attachmentOwnerId,
                draft.attachments
              ),
          });
    const adoption =
      serializedAttachments === undefined
        ? undefined
        : yield* adoptDraftAttachments(request.draftId, serializedAttachments);
    const outcome = yield* keySerial
      .runEffect(
        request,
        withScheduledMailDatabase(
          (database) =>
            // oxlint-disable-next-line eslint/complexity -- The tagged edit-action union is intentionally committed in one atomic draft-and-schedule transaction.
            database.transaction(async (transaction) => {
              const [row] = await transaction
                .select(joinedScheduledMessageSelection)
                .from(scheduledMessages)
                .innerJoin(
                  mailDrafts,
                  eq(mailDrafts.id, scheduledMessages.draftId)
                )
                .where(
                  and(
                    eq(scheduledMessages.draftId, request.draftId),
                    eq(mailDrafts.accountEmail, request.accountId)
                  )
                )
                .limit(1)
                .all();
              if (row === undefined || row.schedule.status === "sent") {
                throw scheduledMailError(
                  "The scheduled email no longer exists"
                );
              }
              if (
                row.schedule.status === "preparing" ||
                row.schedule.status === "sending"
              ) {
                throw scheduledMailError(
                  "The scheduled email is already being sent"
                );
              }
              if (
                request.action.kind === "save" ||
                request.action.kind === "reschedule" ||
                request.action.kind === "send-now"
              ) {
                const account =
                  await transaction.query.googleAccounts.findFirst({
                    columns: { email: true },
                    where: { email: request.accountId },
                  });
                if (account === undefined) {
                  throw scheduledMailError(
                    "The Google account is no longer connected"
                  );
                }
              }
              if (
                request.action.kind === "reschedule" ||
                request.action.kind === "send-now"
              ) {
                assertPossibleDuplicateAcknowledged(
                  row.schedule,
                  request.action.allowPossibleDuplicate
                );
              }

              const previousAttachments = decodeAttachments(
                row.draft.attachments
              );
              if (draft !== undefined && adoption !== undefined) {
                const values = toScheduledDraftValues(
                  draft,
                  adoption.attachments,
                  row.draft.createdAt,
                  now
                );
                await upsertScheduledDraft(transaction, values);
              }

              if (request.action.kind === "discard") {
                await transaction
                  .delete(mailDrafts)
                  .where(
                    and(
                      eq(mailDrafts.id, request.draftId),
                      eq(mailDrafts.accountEmail, request.accountId)
                    )
                  )
                  .run();
                return { kind: "remove" as const, previousAttachments };
              }
              const isUnknownAttention =
                row.schedule.status === "attention" &&
                row.schedule.attentionReason === "outcome-unknown";
              const retryingUnknown =
                isUnknownAttention &&
                (request.action.kind === "reschedule" ||
                  request.action.kind === "send-now");
              const scheduledAt = getEditedScheduledAt(
                request.action,
                row.schedule.scheduledAt,
                now
              );
              await transaction
                .update(scheduledMessages)
                .set(
                  request.action.kind === "save"
                    ? {
                        revision: row.schedule.revision + 1,
                        updatedAt: now,
                      }
                    : {
                        attemptCount: 0,
                        attemptId: null,
                        attentionReason: null,
                        lastAttemptAt: null,
                        nextAttemptAt: scheduledAt,
                        notificationClaimId: null,
                        notificationClaimedAt: null,
                        notifiedAt: null,
                        rateLimitStartedAt: null,
                        revision: row.schedule.revision + 1,
                        rfcMessageId: retryingUnknown
                          ? `<${randomUUID()}@scheduled.kisa.invalid>`
                          : row.schedule.rfcMessageId,
                        scheduledAt,
                        status: "scheduled",
                        updatedAt: now,
                      }
                )
                .where(
                  and(
                    eq(scheduledMessages.draftId, request.draftId),
                    eq(scheduledMessages.revision, row.schedule.revision),
                    accountOwnsScheduledDraft(request)
                  )
                )
                .run();
              if (
                request.action.kind === "save" ||
                request.action.kind === "reschedule"
              ) {
                const [savedRow] = await transaction
                  .select(joinedScheduledMessageSelection)
                  .from(scheduledMessages)
                  .innerJoin(
                    mailDrafts,
                    eq(mailDrafts.id, scheduledMessages.draftId)
                  )
                  .where(
                    and(
                      eq(scheduledMessages.draftId, request.draftId),
                      accountOwnsScheduledDraft(request)
                    )
                  )
                  .limit(1)
                  .all();
                if (savedRow === undefined) {
                  throw scheduledMailError(
                    "Could not reload the saved scheduled email"
                  );
                }
                return {
                  kind: "saved" as const,
                  previousAttachments,
                  session: {
                    draft: toMailDraft(savedRow.draft, attachmentOwnerId),
                    item: toScheduledMailSummary(savedRow),
                  },
                };
              }
              return { kind: "upsert" as const, previousAttachments };
            }),
          "Could not update scheduled email"
        )
      )
      .pipe(
        Effect.catch((error) =>
          adoption === undefined
            ? Effect.fail(error)
            : cleanupAdoptedAttachments((store) =>
                store.delete(adoption.created)
              ).pipe(Effect.andThen(Effect.fail(error)))
        )
      );

    yield* cleanupAdoptedAttachments((store) =>
      store.deleteNotRetained(
        outcome.previousAttachments,
        outcome.kind === "remove" ? [] : (adoption?.attachments ?? [])
      )
    );

    notifyScheduledMailChanged(
      request,
      outcome.kind === "saved" || outcome.kind === "upsert"
        ? "upsert"
        : "remove"
    );
    void scheduledMailWorker.wake();
    const result: ScheduledMailFinishEditResult =
      outcome.kind === "saved"
        ? { kind: "saved", session: outcome.session }
        : { kind: "finished" };
    return result;
  }
);

const cancelOrDiscardScheduledMail = Effect.fn("cancelOrDiscardScheduledMail")(
  function* cancelOrDiscardScheduledMail(
    request: ScheduledMailKey,
    discard: boolean
  ) {
    const now = yield* Clock.currentTimeMillis;
    const result = yield* keySerial.runEffect(
      request,
      withScheduledMailDatabase((database) =>
        database.transaction(async (transaction) => {
          const [row] = await transaction
            .select(joinedScheduledMessageSelection)
            .from(scheduledMessages)
            .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
            .where(
              and(
                eq(scheduledMessages.draftId, request.draftId),
                eq(mailDrafts.accountEmail, request.accountId)
              )
            )
            .limit(1)
            .all();
          if (row === undefined || row.schedule.status === "sent") {
            throw scheduledMailError("The scheduled email no longer exists");
          }
          if (row.schedule.status === "sending") {
            throw scheduledMailError(
              "The scheduled email is already being sent"
            );
          }
          const deletion = discard
            ? transaction
                .delete(mailDrafts)
                .where(
                  and(
                    eq(mailDrafts.id, request.draftId),
                    eq(mailDrafts.accountEmail, request.accountId)
                  )
                )
            : transaction
                .delete(scheduledMessages)
                .where(
                  and(
                    eq(scheduledMessages.draftId, request.draftId),
                    accountOwnsScheduledDraft(request)
                  )
                );
          await deletion.run();
          if (discard) {
            return row;
          }
          await transaction
            .update(mailDrafts)
            .set({ updatedAt: now })
            .where(
              and(
                eq(mailDrafts.id, request.draftId),
                eq(mailDrafts.accountEmail, request.accountId)
              )
            )
            .run();
          return { ...row, draft: { ...row.draft, updatedAt: now } };
        })
      )
    );
    yield* Effect.sync(() => {
      if (!discard) {
        notifyStoredDraftUpserted(result.draft);
      }
      notifyScheduledMailChanged(request, "remove");
    });
    return result;
  }
);

export const cancelScheduledMailToStash = Effect.fn(
  "cancelScheduledMailToStash"
)(function* cancelScheduledMailToStash(request: ScheduledMailKey) {
  yield* cancelOrDiscardScheduledMail(request, false);
});

export const discardScheduledMail = Effect.fn("discardScheduledMail")(
  function* discardScheduledMail(request: ScheduledMailKey) {
    const removed = yield* cancelOrDiscardScheduledMail(request, true);
    yield* cleanupAdoptedAttachments((store) =>
      store.delete(decodeAttachments(removed.draft.attachments))
    );
  }
);

export const sendScheduledMailNow = Effect.fn("sendScheduledMailNow")(
  function* sendScheduledMailNow(request: ScheduledMailSendNowRequest) {
    const now = yield* Clock.currentTimeMillis;
    yield* keySerial.runEffect(
      request,
      withScheduledMailDatabase(
        (database) =>
          database.transaction(async (transaction) => {
            const [row] = await transaction
              .select(joinedScheduledMessageSelection)
              .from(scheduledMessages)
              .innerJoin(
                mailDrafts,
                eq(mailDrafts.id, scheduledMessages.draftId)
              )
              .where(
                and(
                  eq(scheduledMessages.draftId, request.draftId),
                  eq(mailDrafts.accountEmail, request.accountId)
                )
              )
              .limit(1)
              .all();
            if (row === undefined || row.schedule.status === "sent") {
              throw scheduledMailError("The scheduled email no longer exists");
            }
            if (row.schedule.status === "sending") {
              throw scheduledMailError(
                "The scheduled email is already being sent"
              );
            }
            const account = await transaction.query.googleAccounts.findFirst({
              columns: { email: true },
              where: { email: request.accountId },
            });
            if (account === undefined) {
              throw scheduledMailError(
                "The Google account is no longer connected"
              );
            }
            assertPossibleDuplicateAcknowledged(
              row.schedule,
              request.allowPossibleDuplicate
            );
            await transaction
              .update(scheduledMessages)
              .set({
                attemptCount: 0,
                attemptId: null,
                attentionReason: null,
                lastAttemptAt: null,
                nextAttemptAt: now,
                notificationClaimId: null,
                notificationClaimedAt: null,
                notifiedAt: null,
                rateLimitStartedAt: null,
                revision: row.schedule.revision + 1,
                rfcMessageId:
                  row.schedule.attentionReason === "outcome-unknown"
                    ? `<${randomUUID()}@scheduled.kisa.invalid>`
                    : row.schedule.rfcMessageId,
                scheduledAt: now,
                status: "scheduled",
                updatedAt: now,
              })
              .where(
                and(
                  eq(scheduledMessages.draftId, request.draftId),
                  eq(scheduledMessages.revision, row.schedule.revision),
                  accountOwnsScheduledDraft(request)
                )
              )
              .run();
          }),
        "Could not send scheduled email"
      )
    );
    notifyScheduledMailChanged(request, "upsert");
    void scheduledMailWorker.wake();
  }
);

export const forgetAccountScheduledMail = Effect.fn(
  "forgetAccountScheduledMail"
)(function* forgetAccountScheduledMail(accountId: string) {
  const draftIds = yield* withDatabaseClient(async (database) => {
    const rows = await database
      .select({ draftId: scheduledMessages.draftId })
      .from(scheduledMessages)
      .innerJoin(mailDrafts, eq(mailDrafts.id, scheduledMessages.draftId))
      .where(eq(mailDrafts.accountEmail, accountId))
      .all();
    await database
      .delete(scheduledMessages)
      .where(
        sql`exists (
          select 1 from ${mailDrafts}
          where ${mailDrafts.id} = ${scheduledMessages.draftId}
            and ${mailDrafts.accountEmail} = ${accountId}
        )`
      )
      .run();
    return rows.map(({ draftId }) => draftId);
  }).pipe(
    Effect.mapError(() =>
      scheduledMailError("Could not delete account scheduled email")
    )
  );

  yield* Effect.sync(() => {
    closeScheduledMailNotifications(accountId);
    for (const draftId of draftIds) {
      notifyScheduledMailChanged({ accountId, draftId }, "remove");
    }
  });
});

export const adoptLegacyScheduledMailAttachments = Effect.fn(
  "adoptLegacyScheduledMailAttachments"
)(function* adoptLegacyScheduledMailAttachments() {
  const store = getOptionalDraftAttachmentStore();
  if (store === undefined) {
    return;
  }
  const rows = yield* withScheduledMailDatabase(
    (database) =>
      database
        .select({
          accountId: mailDrafts.accountEmail,
          attachments: mailDrafts.attachments,
          draftId: mailDrafts.id,
          revision: scheduledMessages.revision,
        })
        .from(mailDrafts)
        .innerJoin(
          scheduledMessages,
          eq(scheduledMessages.draftId, mailDrafts.id)
        )
        .where(ne(scheduledMessages.status, "sent"))
        .all(),
    "Could not prepare scheduled attachments"
  );

  for (const row of rows) {
    const { accountId } = row;
    const attachments = decodeStoredOutgoingAttachmentsStrict(row.attachments);
    if (
      accountId === null ||
      attachments === undefined ||
      attachments.every((attachment) => attachment.storage === "app-owned")
    ) {
      continue;
    }
    const key = { accountId, draftId: row.draftId };
    yield* keySerial
      .runEffect(
        key,
        Effect.gen(function* adoptLegacyRow() {
          const adoption = yield* adoptDraftAttachments(
            row.draftId,
            attachments
          );
          const updated = yield* withScheduledMailDatabase(
            (database) =>
              database
                .update(mailDrafts)
                .set({ attachments: adoption.attachments })
                .where(
                  and(
                    eq(mailDrafts.id, row.draftId),
                    eq(mailDrafts.accountEmail, accountId),
                    eq(mailDrafts.attachments, row.attachments),
                    sql`exists (
                      select 1 from ${scheduledMessages}
                      where ${scheduledMessages.draftId} = ${row.draftId}
                        and ${scheduledMessages.revision} = ${row.revision}
                        and ${scheduledMessages.status} <> 'sent'
                    )`
                  )
                )
                .returning({ id: mailDrafts.id })
                .all(),
            "Could not prepare scheduled attachments"
          ).pipe(
            Effect.catch((error) =>
              bestEffortDraftAttachmentCleanup(
                store.delete(adoption.created)
              ).pipe(Effect.andThen(Effect.fail(error)))
            )
          );
          if (updated.length === 0) {
            yield* bestEffortDraftAttachmentCleanup(
              store.delete(adoption.created)
            );
            return;
          }
          yield* bestEffortDraftAttachmentCleanup(
            store.deleteNotRetained(attachments, adoption.attachments)
          );
        })
      )
      .pipe(
        Effect.catch(() =>
          Effect.logWarning(
            "Could not move a scheduled attachment into app storage"
          )
        )
      );
  }
});

const scheduledMailLifecycle = createScheduledMailLifecycle({
  dispatchPendingNotifications: dispatchPendingScheduledMailNotifications,
  listenForResume: (listener) => {
    powerMonitor.on("resume", listener);
    return () => powerMonitor.off("resume", listener);
  },
  releaseStaleNotificationClaims: releaseStaleScheduledMailNotificationClaims,
  scheduleRetry: (run, delayMs) => {
    const timeout = setTimeout(run, delayMs);
    return { cancel: () => clearTimeout(timeout) };
  },
  startWorker: () => scheduledMailWorker.start(),
  stopWorker: () => scheduledMailWorker.stop(),
  wakeWorker: () => {
    void scheduledMailWorker.wake();
  },
});

export const startScheduledMail = (): Promise<void> =>
  scheduledMailLifecycle.start();

export const stopScheduledMail = (): Promise<void> =>
  scheduledMailLifecycle.stop();
