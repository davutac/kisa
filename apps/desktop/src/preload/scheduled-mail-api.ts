import { ipcRenderer } from "electron";

import type { DesktopBridge } from "../shared/ipc/bridge";
import {
  SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL,
  SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL,
  SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL,
  SCHEDULED_MAIL_CHANGED_CHANNEL,
  SCHEDULED_MAIL_DISCARD_CHANNEL,
  SCHEDULED_MAIL_FINISH_EDIT_CHANNEL,
  SCHEDULED_MAIL_LIST_PAGE_CHANNEL,
  SCHEDULED_MAIL_OUTCOME_CHANNEL,
  SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL,
  SCHEDULED_MAIL_SCHEDULE_CHANNEL,
  SCHEDULED_MAIL_SEND_NOW_CHANNEL,
} from "../shared/ipc/channels";
import {
  ScheduledMailChanged,
  ScheduledMailOutcome,
} from "../shared/ipc/scheduled-mail";
import { subscribe } from "./subscribe";

const setOutcomeReadiness = async (ready: boolean): Promise<void> => {
  try {
    await ipcRenderer.invoke(SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL, ready);
  } catch {
    // Startup and teardown may race handler installation; native feedback remains the fallback.
  }
};

export const scheduledMailApi: Pick<
  DesktopBridge,
  | "beginScheduledMailEdit"
  | "cancelScheduledMailToStash"
  | "discardScheduledMail"
  | "finishScheduledMailEdit"
  | "getScheduledMailAttentionCount"
  | "listScheduledMailPage"
  | "onScheduledMailChanged"
  | "onScheduledMailOutcome"
  | "scheduleMail"
  | "sendScheduledMailNow"
> = {
  beginScheduledMailEdit: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL, request),
  cancelScheduledMailToStash: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL, request),
  discardScheduledMail: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_DISCARD_CHANNEL, request),
  finishScheduledMailEdit: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_FINISH_EDIT_CHANNEL, request),
  getScheduledMailAttentionCount: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL, request),
  listScheduledMailPage: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_LIST_PAGE_CHANNEL, request),
  onScheduledMailChanged: (listener) =>
    subscribe(SCHEDULED_MAIL_CHANGED_CHANNEL, ScheduledMailChanged, listener),
  onScheduledMailOutcome: (listener) => {
    const unsubscribe = subscribe(
      SCHEDULED_MAIL_OUTCOME_CHANNEL,
      ScheduledMailOutcome,
      listener
    );
    void setOutcomeReadiness(true);
    return () => {
      unsubscribe();
      void setOutcomeReadiness(false);
    };
  },
  scheduleMail: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_SCHEDULE_CHANNEL, request),
  sendScheduledMailNow: (request) =>
    ipcRenderer.invoke(SCHEDULED_MAIL_SEND_NOW_CHANNEL, request),
};
