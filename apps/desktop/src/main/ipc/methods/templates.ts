import * as Schema from "effect/Schema";

import {
  COMPOSER_TEMPLATE_DELETE_CHANNEL,
  COMPOSER_TEMPLATE_LIST_CHANNEL,
  COMPOSER_TEMPLATE_SAVE_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  ComposerTemplateDeleteReply,
  ComposerTemplateDeleteRequest,
  ComposerTemplateInput,
  ComposerTemplateListReply,
  ComposerTemplateSaveReply,
} from "../../../shared/ipc/templates";
import {
  deleteComposerTemplate,
  listComposerTemplates,
  saveComposerTemplate,
} from "../../templates/composer-templates";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const listTemplates = makeIpcMethod({
  channel: COMPOSER_TEMPLATE_LIST_CHANNEL,
  handler: () =>
    toIpcReply(listComposerTemplates(), "Could not load templates"),
  payload: Schema.Void,
  result: ComposerTemplateListReply,
});

export const saveTemplate = makeIpcMethod({
  channel: COMPOSER_TEMPLATE_SAVE_CHANNEL,
  handler: (request) =>
    toIpcReply(saveComposerTemplate(request), "Could not save template"),
  payload: ComposerTemplateInput,
  result: ComposerTemplateSaveReply,
});

export const deleteTemplate = makeIpcMethod({
  channel: COMPOSER_TEMPLATE_DELETE_CHANNEL,
  handler: (request) =>
    toIpcReply(deleteComposerTemplate(request), "Could not delete template"),
  payload: ComposerTemplateDeleteRequest,
  result: ComposerTemplateDeleteReply,
});
