import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  COMPOSER_TEMPLATE_CHANGED_CHANNEL,
  COMPOSER_TEMPLATE_DELETE_CHANNEL,
  COMPOSER_TEMPLATE_LIST_CHANNEL,
  COMPOSER_TEMPLATE_SAVE_CHANNEL,
} from "../shared/ipc/channels";
import { ComposerTemplateChanged } from "../shared/ipc/templates";
import { subscribe } from "./subscribe";

export const templateApi: Pick<
  DesktopBridge,
  | "deleteComposerTemplate"
  | "listComposerTemplates"
  | "onComposerTemplateChanged"
  | "saveComposerTemplate"
> = {
  deleteComposerTemplate: (request) =>
    ipcRenderer.invoke(COMPOSER_TEMPLATE_DELETE_CHANNEL, request),
  listComposerTemplates: () =>
    ipcRenderer.invoke(COMPOSER_TEMPLATE_LIST_CHANNEL),
  onComposerTemplateChanged: (listener) =>
    subscribe(
      COMPOSER_TEMPLATE_CHANGED_CHANNEL,
      ComposerTemplateChanged,
      listener
    ),
  saveComposerTemplate: (request) =>
    ipcRenderer.invoke(COMPOSER_TEMPLATE_SAVE_CHANNEL, request),
};
