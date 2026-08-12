import { composerTemplates } from "@repo/database/schemas";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { Clock, Effect, Schema } from "effect";

import { COMPOSER_TEMPLATE_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type {
  ComposerTemplate,
  ComposerTemplateDeleteRequest,
  ComposerTemplateInput,
} from "../../shared/ipc/templates";
import { ComposerTemplateChanged } from "../../shared/ipc/templates";
import { validateTemplateText } from "../../shared/template-variables";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";

// oxlint-disable-next-line unicorn/throw-new-error
class ComposerTemplateError extends Schema.TaggedError<ComposerTemplateError>()(
  "ComposerTemplateError",
  { message: Schema.String }
) {}

type ComposerTemplateRow = typeof composerTemplates.$inferSelect;

const toComposerTemplate = (row: ComposerTemplateRow): ComposerTemplate => ({
  accountId: row.accountEmail,
  bcc: row.bcc,
  body: { html: row.bodyHtml, text: row.bodyText },
  cc: row.cc,
  createdAt: row.createdAt,
  id: row.id,
  name: row.name,
  subject: row.subject,
  to: row.to,
  updatedAt: row.updatedAt,
});

export const listComposerTemplates = Effect.fn("listComposerTemplates")(
  function* listComposerTemplates() {
    const rows = yield* withDatabaseClient((database) =>
      database
        .select()
        .from(composerTemplates)
        .orderBy(asc(composerTemplates.name), asc(composerTemplates.id))
        .all()
    ).pipe(
      Effect.mapError(
        () => new ComposerTemplateError({ message: "Could not load templates" })
      )
    );

    return rows.map(toComposerTemplate);
  }
);

export const notifyComposerTemplatesChanged = Effect.fn(
  "notifyComposerTemplatesChanged"
)(function* notifyComposerTemplatesChanged() {
  const templates = yield* listComposerTemplates();
  for (const template of templates) {
    sendRendererEvent(
      COMPOSER_TEMPLATE_CHANGED_CHANNEL,
      ComposerTemplateChanged,
      { kind: "upsert", template }
    );
  }
});

export const saveComposerTemplate = Effect.fn("saveComposerTemplate")(
  function* saveComposerTemplate(input: ComposerTemplateInput) {
    const name = input.name.trim();
    if (name.length === 0) {
      return yield* new ComposerTemplateError({
        message: "Template name is required",
      });
    }
    for (const value of [input.subject, input.body.text]) {
      const validation = validateTemplateText(value);
      if (!validation.ok) {
        return yield* new ComposerTemplateError({
          message: validation.message,
        });
      }
    }

    const updatedAt = yield* Clock.currentTimeMillis;
    const saved = yield* withDatabaseClient((database) =>
      database.transaction(async (transaction) => {
        if (input.accountId !== null) {
          const account = await transaction.query.googleAccounts.findFirst({
            where: { email: input.accountId },
          });
          if (account === undefined) {
            throw new Error("Template account is not connected");
          }
        }

        const existing = await transaction.query.composerTemplates.findFirst({
          where: { id: input.id },
        });
        const duplicate = await transaction
          .select({ id: composerTemplates.id })
          .from(composerTemplates)
          .where(
            and(
              sql`lower(${composerTemplates.name}) = lower(${name})`,
              ne(composerTemplates.id, input.id)
            )
          )
          .get();
        if (duplicate !== undefined) {
          throw new Error("Template name already exists");
        }
        const values: typeof composerTemplates.$inferInsert = {
          accountEmail: input.accountId,
          bcc: input.bcc,
          bodyHtml: input.body.html,
          bodyText: input.body.text,
          cc: input.cc,
          createdAt: existing?.createdAt ?? updatedAt,
          id: input.id,
          name,
          subject: input.subject,
          to: input.to,
          updatedAt,
        };

        await transaction
          .insert(composerTemplates)
          .values(values)
          .onConflictDoUpdate({
            set: {
              accountEmail: values.accountEmail,
              bcc: values.bcc,
              bodyHtml: values.bodyHtml,
              bodyText: values.bodyText,
              cc: values.cc,
              name: values.name,
              subject: values.subject,
              to: values.to,
              updatedAt: values.updatedAt,
            },
            target: composerTemplates.id,
          })
          .run();

        return toComposerTemplate({
          ...values,
          accountEmail: values.accountEmail ?? null,
        });
      })
    ).pipe(
      Effect.mapError(
        () => new ComposerTemplateError({ message: "Could not save template" })
      )
    );

    sendRendererEvent(
      COMPOSER_TEMPLATE_CHANGED_CHANNEL,
      ComposerTemplateChanged,
      { kind: "upsert", template: saved }
    );
    return saved;
  }
);

export const deleteComposerTemplate = Effect.fn("deleteComposerTemplate")(
  function* deleteComposerTemplate(request: ComposerTemplateDeleteRequest) {
    const removed = yield* withDatabaseClient((database) =>
      database.transaction(async (transaction) => {
        const existing = await transaction.query.composerTemplates.findFirst({
          where: { id: request.templateId },
        });
        if (existing !== undefined) {
          await transaction
            .delete(composerTemplates)
            .where(eq(composerTemplates.id, request.templateId))
            .run();
        }
        return existing !== undefined;
      })
    ).pipe(
      Effect.mapError(
        () =>
          new ComposerTemplateError({ message: "Could not delete template" })
      )
    );

    if (removed) {
      sendRendererEvent(
        COMPOSER_TEMPLATE_CHANGED_CHANNEL,
        ComposerTemplateChanged,
        { kind: "remove", templateId: request.templateId }
      );
    }
  }
);
