import { mailDrafts, scheduledMessages } from "@repo/database/schemas";
import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";

import { hasEmailSignature } from "../../shared/email-signature";
import { MAIL_DRAFT_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type {
  MailDraft,
  MailDraftDiscardRequest,
  MailDraftInput,
  MailDraftListRequest,
  MailDraftSignature,
} from "../../shared/ipc/mail";
import { MailDraftChanged } from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database-query";
import {
  sendRendererEvent,
  sendRendererEventToEachWindow,
} from "../electron/renderer-events";
import type { DraftAttachmentStore } from "./draft-attachment-store";
import {
  bestEffortDraftAttachmentCleanup,
  getOptionalDraftAttachmentStore,
} from "./draft-attachment-store";
import {
  bindOutgoingAttachmentOwner,
  outgoingAttachmentAuthorizations,
} from "./outgoing-attachment-authorizations";
import { decodeStoredOutgoingAttachmentsStrict } from "./outgoing-attachment-files";

// oxlint-disable-next-line unicorn/throw-new-error
class MailDraftError extends Schema.TaggedError<MailDraftError>()(
  "MailDraftError",
  { message: Schema.String }
) {}

type MailDraftRow = typeof mailDrafts.$inferSelect;

const decodeStoredAttachments = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Stored JSON is strictly decoded at the database boundary.
  input: unknown
): readonly StoredMailDraftAttachment[] =>
  decodeStoredOutgoingAttachmentsStrict(input) ?? [];

const cleanupOwnedAttachments = (
  cleanup: (store: DraftAttachmentStore) => Effect.Effect<void, unknown>
): Effect.Effect<void> => {
  const store = getOptionalDraftAttachmentStore();
  if (store === undefined) {
    return Effect.void;
  }
  return bestEffortDraftAttachmentCleanup(cleanup(store));
};

const toMailDraftSignature = (
  row: MailDraftRow
): MailDraftSignature | undefined => {
  if (
    row.signatureAccountEmail === null ||
    row.signatureHtml === null ||
    row.signatureText === null
  ) {
    return undefined;
  }

  return {
    accountId: row.signatureAccountEmail,
    body: { html: row.signatureHtml, text: row.signatureText },
  };
};

const toStoredSignature = (signature: MailDraftSignature | undefined) => {
  if (signature === undefined) {
    return {
      signatureAccountEmail: null,
      signatureHtml: null,
      signatureText: null,
    };
  }

  return {
    signatureAccountEmail: signature.accountId,
    signatureHtml: signature.body.html,
    signatureText: signature.body.text,
  };
};

const hasValidDraftSignature = (input: MailDraftInput): boolean =>
  input.signature === undefined ||
  (input.accountId === input.signature.accountId &&
    hasEmailSignature(input.body, input.signature.body));

const hasValidDraftContext = (input: MailDraftInput): boolean =>
  (input.kind === "new"
    ? input.messageId === undefined && input.threadId === undefined
    : input.accountId !== undefined &&
      input.messageId !== undefined &&
      input.threadId !== undefined) && hasValidDraftSignature(input);

export const toMailDraft = (
  row: MailDraftRow,
  ownerWebContentsId: number
): MailDraft => ({
  accountId: row.accountEmail ?? undefined,
  attachments: outgoingAttachmentAuthorizations.restoreDraftAttachments(
    ownerWebContentsId,
    row.attachments,
    row.bodyHtml
  ),
  bcc: row.bcc,
  body: { html: row.bodyHtml, text: row.bodyText },
  cc: row.cc,
  createdAt: row.createdAt,
  id: row.id,
  kind: row.kind,
  messageId: row.messageId ?? undefined,
  signature: toMailDraftSignature(row),
  subject: row.subject,
  threadId: row.threadId ?? undefined,
  to: row.to,
  updatedAt: row.updatedAt,
});

const notifyDraftChanged = (change: MailDraftChanged): void => {
  sendRendererEvent(MAIL_DRAFT_CHANGED_CHANNEL, MailDraftChanged, change);
};

export const notifyDraftRemoved = (
  draftId: string,
  accountId: string
): void => {
  notifyDraftChanged({ accountId, draftId, kind: "remove" });
};

export const notifyDraftUpserted = (
  draft: MailDraft,
  sourceOwnerId: number,
  storedAttachments: readonly StoredMailDraftAttachment[]
): void => {
  sendRendererEventToEachWindow(
    MAIL_DRAFT_CHANGED_CHANNEL,
    MailDraftChanged,
    (webContents) => {
      const ownerId = bindOutgoingAttachmentOwner(webContents);
      return {
        draft: {
          ...draft,
          attachments:
            ownerId === sourceOwnerId
              ? draft.attachments
              : outgoingAttachmentAuthorizations.restoreDraftAttachments(
                  ownerId,
                  storedAttachments
                ),
        },
        kind: "upsert" as const,
      };
    }
  );
};

export const notifyStoredDraftUpserted = (row: MailDraftRow): void => {
  sendRendererEventToEachWindow(
    MAIL_DRAFT_CHANGED_CHANNEL,
    MailDraftChanged,
    (webContents) => ({
      draft: toMailDraft(row, bindOutgoingAttachmentOwner(webContents)),
      kind: "upsert" as const,
    })
  );
};

export const listStashedDrafts = Effect.fn("listStashedDrafts")(
  function* listStashedDrafts(
    request: MailDraftListRequest,
    ownerWebContentsId: number
  ) {
    const rows = yield* withDatabaseClient((database) =>
      database
        .select()
        .from(mailDrafts)
        .leftJoin(
          scheduledMessages,
          eq(scheduledMessages.draftId, mailDrafts.id)
        )
        .where(
          and(
            eq(mailDrafts.kind, "new"),
            isNull(scheduledMessages.draftId),
            request.accountIds.length === 0
              ? isNull(mailDrafts.accountEmail)
              : or(
                  isNull(mailDrafts.accountEmail),
                  inArray(mailDrafts.accountEmail, [...request.accountIds])
                )
          )
        )
        .orderBy(desc(mailDrafts.updatedAt))
        .all()
    ).pipe(
      Effect.mapError(
        () => new MailDraftError({ message: "Could not load stashed drafts" })
      )
    );

    return rows.map(({ mail_drafts: row }) =>
      toMailDraft(row, ownerWebContentsId)
    );
  }
);

export const loadThreadDraft = Effect.fn("loadThreadDraft")(
  function* loadThreadDraft(
    accountId: string,
    threadId: string,
    ownerWebContentsId: number
  ) {
    const rows = yield* withDatabaseClient((database) =>
      database
        .select()
        .from(mailDrafts)
        .where(
          and(
            eq(mailDrafts.accountEmail, accountId),
            eq(mailDrafts.threadId, threadId)
          )
        )
        .orderBy(desc(mailDrafts.updatedAt))
        .limit(1)
        .all()
    ).pipe(
      Effect.mapError(
        () => new MailDraftError({ message: "Could not load saved reply" })
      )
    );
    const [row] = rows;

    return row === undefined ? null : toMailDraft(row, ownerWebContentsId);
  }
);

export const saveMailDraft = Effect.fn("saveMailDraft")(function* saveMailDraft(
  input: MailDraftInput,
  ownerWebContentsId: number
) {
  const updatedAt = yield* Clock.currentTimeMillis;
  const storedAttachments = yield* Effect.try({
    catch: (error) =>
      new MailDraftError({
        message:
          error instanceof Error ? error.message : "Could not save draft",
      }),
    try: () =>
      outgoingAttachmentAuthorizations.serializeDraftAttachments(
        ownerWebContentsId,
        input.attachments
      ),
  });
  const saved = yield* withDatabaseClient((database) =>
    database.transaction(async (transaction) => {
      if (!hasValidDraftContext(input)) {
        throw new Error("Draft context does not match its kind");
      }

      if (input.accountId !== undefined) {
        const account = await transaction.query.googleAccounts.findFirst({
          where: { email: input.accountId },
        });
        if (account === undefined) {
          throw new Error("Draft account is not connected");
        }
      }

      const existing = await transaction.query.mailDrafts.findFirst({
        where: { id: input.id },
      });
      const scheduled = await transaction.query.scheduledMessages.findFirst({
        columns: { draftId: true },
        where: { draftId: input.id },
      });
      if (scheduled !== undefined) {
        throw new Error(
          "Scheduled drafts must be edited through scheduled mail"
        );
      }
      const replaced =
        input.threadId === undefined || input.accountId === undefined
          ? undefined
          : await transaction.query.mailDrafts.findFirst({
              where: {
                accountEmail: input.accountId,
                threadId: input.threadId,
              },
            });
      const values: typeof mailDrafts.$inferInsert = {
        accountEmail: input.accountId ?? null,
        attachments: storedAttachments,
        bcc: input.bcc,
        bodyHtml: input.body.html,
        bodyText: input.body.text,
        cc: input.cc,
        createdAt: existing?.createdAt ?? updatedAt,
        id: input.id,
        kind: input.kind,
        messageId: input.messageId,
        ...toStoredSignature(input.signature),
        subject: input.subject,
        threadId: input.threadId,
        to: input.to,
        updatedAt,
      };

      if (input.threadId === undefined) {
        await transaction
          .insert(mailDrafts)
          .values(values)
          .onConflictDoUpdate({
            set: {
              accountEmail: values.accountEmail,
              attachments: values.attachments,
              bcc: values.bcc,
              bodyHtml: values.bodyHtml,
              bodyText: values.bodyText,
              cc: values.cc,
              kind: values.kind,
              messageId: values.messageId,
              signatureAccountEmail: values.signatureAccountEmail,
              signatureHtml: values.signatureHtml,
              signatureText: values.signatureText,
              subject: values.subject,
              threadId: values.threadId,
              to: values.to,
              updatedAt: values.updatedAt,
            },
            target: mailDrafts.id,
          })
          .run();
      } else {
        const { accountId } = input;
        if (accountId === undefined) {
          throw new Error("Thread drafts require an account");
        }
        await transaction
          .delete(mailDrafts)
          .where(
            and(
              eq(mailDrafts.accountEmail, accountId),
              eq(mailDrafts.threadId, input.threadId)
            )
          )
          .run();
        await transaction.insert(mailDrafts).values(values).run();
      }

      return {
        createdAt: values.createdAt,
        previousAttachments: [
          ...decodeStoredAttachments(existing?.attachments),
          ...(replaced?.id === existing?.id
            ? []
            : decodeStoredAttachments(replaced?.attachments)),
        ],
        replacedDraftId: replaced?.id === input.id ? undefined : replaced?.id,
      };
    })
  ).pipe(
    Effect.mapError(
      () => new MailDraftError({ message: "Could not save draft" })
    )
  );
  const draft: MailDraft = { ...input, createdAt: saved.createdAt, updatedAt };

  yield* cleanupOwnedAttachments((store) =>
    store.deleteNotRetained(saved.previousAttachments, storedAttachments)
  );

  if (saved.replacedDraftId !== undefined) {
    notifyDraftChanged({
      accountId: input.accountId,
      draftId: saved.replacedDraftId,
      kind: "remove",
      threadId: input.threadId,
    });
  }
  notifyDraftUpserted(draft, ownerWebContentsId, storedAttachments);
  return draft;
});

export const discardMailDraft = Effect.fn("discardMailDraft")(
  function* discardMailDraft(request: MailDraftDiscardRequest) {
    const removed = yield* withDatabaseClient((database) =>
      database.transaction(async (transaction) => {
        const drafts = await transaction
          .select()
          .from(mailDrafts)
          .where(
            and(
              eq(mailDrafts.id, request.draftId),
              request.accountId === undefined
                ? isNull(mailDrafts.accountEmail)
                : eq(mailDrafts.accountEmail, request.accountId)
            )
          )
          .all();
        const [draft] = drafts;

        if (draft !== undefined) {
          const scheduled = await transaction.query.scheduledMessages.findFirst(
            {
              columns: { draftId: true },
              where: { draftId: request.draftId },
            }
          );
          if (scheduled !== undefined) {
            throw new Error(
              "Scheduled drafts must be discarded through scheduled mail"
            );
          }
          await transaction
            .delete(mailDrafts)
            .where(eq(mailDrafts.id, request.draftId))
            .run();
        }

        return draft;
      })
    ).pipe(
      Effect.mapError(
        () => new MailDraftError({ message: "Could not discard draft" })
      )
    );

    if (removed !== undefined) {
      notifyDraftChanged({
        accountId: removed.accountEmail ?? undefined,
        draftId: request.draftId,
        kind: "remove",
        threadId: removed.threadId ?? undefined,
      });
    }
    if (request.preserveAttachments !== true) {
      yield* cleanupOwnedAttachments((store) =>
        store
          .delete(decodeStoredAttachments(removed?.attachments))
          .pipe(Effect.andThen(store.deleteDraft(request.draftId)))
      );
    }
  }
);

export const forgetAccountDrafts = Effect.fn("forgetAccountDrafts")(
  function* forgetAccountDrafts(accountId: string) {
    const removed = yield* withDatabaseClient((database) =>
      database.transaction(async (transaction) => {
        const rows = await transaction
          .select({ attachments: mailDrafts.attachments })
          .from(mailDrafts)
          .where(eq(mailDrafts.accountEmail, accountId))
          .all();
        await transaction
          .delete(mailDrafts)
          .where(eq(mailDrafts.accountEmail, accountId))
          .run();
        return rows;
      })
    ).pipe(
      Effect.mapError(
        () => new MailDraftError({ message: "Could not delete account drafts" })
      )
    );
    yield* cleanupOwnedAttachments((store) =>
      store.delete(
        removed.flatMap(({ attachments }) =>
          decodeStoredAttachments(attachments)
        )
      )
    );
  }
);

export const reconcileDraftAttachmentStore = Effect.fn(
  "reconcileDraftAttachmentStore"
)(function* reconcileDraftAttachmentStore() {
  const rows = yield* withDatabaseClient((database) =>
    database
      .select({ attachments: mailDrafts.attachments })
      .from(mailDrafts)
      .all()
  ).pipe(
    Effect.mapError(
      () => new MailDraftError({ message: "Could not reconcile draft files" })
    )
  );
  yield* cleanupOwnedAttachments((store) =>
    store.cleanupOrphans(
      rows.flatMap(({ attachments }) => decodeStoredAttachments(attachments))
    )
  );
});
