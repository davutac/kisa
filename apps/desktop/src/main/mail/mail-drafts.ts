import { mailDrafts } from "@repo/database/schemas";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";

import { MAIL_DRAFT_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type {
  MailDraft,
  MailDraftDiscardRequest,
  MailDraftInput,
  MailDraftListRequest,
} from "../../shared/ipc/mail";
import { MailDraftChanged } from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";

// oxlint-disable-next-line unicorn/throw-new-error
class MailDraftError extends Schema.TaggedErrorClass<MailDraftError>()(
  "MailDraftError",
  { message: Schema.String }
) {}

type MailDraftRow = typeof mailDrafts.$inferSelect;

const toMailDraft = (row: MailDraftRow): MailDraft => ({
  ...(row.accountEmail === null ? {} : { accountId: row.accountEmail }),
  attachments: row.attachments,
  bcc: row.bcc,
  body: { html: row.bodyHtml, text: row.bodyText },
  cc: row.cc,
  createdAt: row.createdAt,
  id: row.id,
  kind: row.kind,
  messageId: row.messageId ?? undefined,
  subject: row.subject,
  threadId: row.threadId ?? undefined,
  to: row.to,
  updatedAt: row.updatedAt,
});

const notifyDraftChanged = (change: MailDraftChanged): void => {
  sendRendererEvent(MAIL_DRAFT_CHANGED_CHANNEL, MailDraftChanged, change);
};

export const listStashedDrafts = Effect.fn("listStashedDrafts")(
  function* listStashedDrafts(request: MailDraftListRequest) {
    const rows = yield* withDatabaseClient((database) =>
      database
        .select()
        .from(mailDrafts)
        .where(
          and(
            eq(mailDrafts.kind, "new"),
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

    return rows.map(toMailDraft);
  }
);

export const loadThreadDraft = Effect.fn("loadThreadDraft")(
  function* loadThreadDraft(accountId: string, threadId: string) {
    const row = yield* withDatabaseClient((database) =>
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
        .get()
    ).pipe(
      Effect.mapError(
        () => new MailDraftError({ message: "Could not load saved reply" })
      )
    );

    return row === undefined ? null : toMailDraft(row);
  }
);

export const saveMailDraft = Effect.fn("saveMailDraft")(function* saveMailDraft(
  input: MailDraftInput
) {
  const updatedAt = yield* Clock.currentTimeMillis;
  const saved = yield* withDatabaseClient((database) =>
    database.transaction(async (transaction) => {
      if (
        (input.kind === "new" &&
          (input.messageId !== undefined || input.threadId !== undefined)) ||
        (input.kind !== "new" &&
          (input.accountId === undefined ||
            input.messageId === undefined ||
            input.threadId === undefined))
      ) {
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
        attachments: input.attachments,
        bcc: input.bcc,
        bodyHtml: input.body.html,
        bodyText: input.body.text,
        cc: input.cc,
        createdAt: existing?.createdAt ?? updatedAt,
        id: input.id,
        kind: input.kind,
        messageId: input.messageId,
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
        replacedDraftId: replaced?.id === input.id ? undefined : replaced?.id,
      };
    })
  ).pipe(
    Effect.mapError(
      () => new MailDraftError({ message: "Could not save draft" })
    )
  );
  const draft: MailDraft = { ...input, createdAt: saved.createdAt, updatedAt };

  if (saved.replacedDraftId !== undefined) {
    notifyDraftChanged({
      accountId: input.accountId,
      draftId: saved.replacedDraftId,
      kind: "remove",
      threadId: input.threadId,
    });
  }
  notifyDraftChanged({ draft, kind: "upsert" });
  return draft;
});

export const discardMailDraft = Effect.fn("discardMailDraft")(
  function* discardMailDraft(request: MailDraftDiscardRequest) {
    const removed = yield* withDatabaseClient((database) =>
      database.transaction(async (transaction) => {
        const draft = await transaction
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
          .get();

        if (draft !== undefined) {
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
        ...(removed.accountEmail === null
          ? {}
          : { accountId: removed.accountEmail }),
        draftId: request.draftId,
        kind: "remove",
        threadId: removed.threadId ?? undefined,
      });
    }
  }
);

export const forgetAccountDrafts = Effect.fn("forgetAccountDrafts")(
  function* forgetAccountDrafts(accountId: string) {
    yield* withDatabaseClient((database) =>
      database
        .delete(mailDrafts)
        .where(eq(mailDrafts.accountEmail, accountId))
        .run()
    ).pipe(
      Effect.mapError(
        () => new MailDraftError({ message: "Could not delete account drafts" })
      )
    );
  }
);
