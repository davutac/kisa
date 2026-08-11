import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const ComposerTemplateBody = Schema.Struct({
  html: Schema.String,
  text: Schema.String,
});
export type ComposerTemplateBody = typeof ComposerTemplateBody.Type;

export const ComposerTemplateInput = Schema.Struct({
  accountId: Schema.NullOr(Schema.NonEmptyString),
  bcc: Schema.Array(Schema.NonEmptyString),
  body: ComposerTemplateBody,
  cc: Schema.Array(Schema.NonEmptyString),
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  subject: Schema.String,
  to: Schema.Array(Schema.NonEmptyString),
});
export type ComposerTemplateInput = typeof ComposerTemplateInput.Type;

export const ComposerTemplate = Schema.Struct({
  ...ComposerTemplateInput.fields,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
});
export type ComposerTemplate = typeof ComposerTemplate.Type;

export const ComposerTemplateDeleteRequest = Schema.Struct({
  templateId: Schema.NonEmptyString,
});
export type ComposerTemplateDeleteRequest =
  typeof ComposerTemplateDeleteRequest.Type;

export const ComposerTemplateChanged = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("upsert"), template: ComposerTemplate }),
  Schema.Struct({
    kind: Schema.Literal("remove"),
    templateId: Schema.NonEmptyString,
  }),
]);
export type ComposerTemplateChanged = typeof ComposerTemplateChanged.Type;

export const ComposerTemplateListReply = IpcReply(
  Schema.Array(ComposerTemplate)
);
export type ComposerTemplateListReply = typeof ComposerTemplateListReply.Type;

export const ComposerTemplateSaveReply = IpcReply(ComposerTemplate);
export type ComposerTemplateSaveReply = typeof ComposerTemplateSaveReply.Type;

export const ComposerTemplateDeleteReply = IpcReply(Schema.Void);
export type ComposerTemplateDeleteReply =
  typeof ComposerTemplateDeleteReply.Type;
