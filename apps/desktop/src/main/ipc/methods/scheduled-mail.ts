import * as Effect from "effect/Effect";

import {
  SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL,
  SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL,
  SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL,
  SCHEDULED_MAIL_DISCARD_CHANNEL,
  SCHEDULED_MAIL_FINISH_EDIT_CHANNEL,
  SCHEDULED_MAIL_LIST_PAGE_CHANNEL,
  SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL,
  SCHEDULED_MAIL_SCHEDULE_CHANNEL,
  SCHEDULED_MAIL_SEND_NOW_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  ScheduledMailActionReply,
  ScheduledMailAttentionCountReply,
  ScheduledMailEditSessionReply,
  ScheduledMailFinishEditReply,
  ScheduledMailFinishEditRequest,
  ScheduledMailKey,
  ScheduledMailPageReply,
  ScheduledMailPageRequest,
  ScheduledMailOutcomeReadiness,
  ScheduledMailScheduleRequest,
  ScheduledMailScope,
  ScheduledMailSendNowRequest,
  ScheduledMailSummaryReply,
} from "../../../shared/ipc/scheduled-mail";
import { bindOutgoingAttachmentOwner } from "../../mail/outgoing-attachment-authorizations";
import {
  beginScheduledMailEdit as beginScheduledMailEditAction,
  cancelScheduledMailToStash as cancelScheduledMailToStashAction,
  discardScheduledMail as discardScheduledMailAction,
  finishScheduledMailEdit as finishScheduledMailEditAction,
  getScheduledMailAttentionCount as getScheduledMailAttentionCountAction,
  listScheduledMailPage as listScheduledMailPageAction,
  scheduleMail as scheduleMailAction,
  sendScheduledMailNow as sendScheduledMailNowAction,
} from "../../mail/scheduled-mail";
import { setScheduledMailOutcomeTargetReadyEffect } from "../../mail/scheduled-mail-notifications";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

const missingOwnerReply = () =>
  Effect.succeed({
    error: "Could not identify this window",
    ok: false as const,
  });

export const listScheduledMailPage = makeIpcMethod({
  channel: SCHEDULED_MAIL_LIST_PAGE_CHANNEL,
  handler: (request) =>
    toIpcReply(
      listScheduledMailPageAction(request),
      "Could not load scheduled email"
    ),
  payload: ScheduledMailPageRequest,
  result: ScheduledMailPageReply,
});

export const getScheduledMailAttentionCount = makeIpcMethod({
  channel: SCHEDULED_MAIL_ATTENTION_COUNT_CHANNEL,
  handler: (request) =>
    toIpcReply(
      getScheduledMailAttentionCountAction(request),
      "Could not check scheduled email"
    ),
  payload: ScheduledMailScope,
  result: ScheduledMailAttentionCountReply,
});

export const scheduleMail = makeIpcMethod({
  channel: SCHEDULED_MAIL_SCHEDULE_CHANNEL,
  handler: (request, event) =>
    event === undefined
      ? missingOwnerReply()
      : toIpcReply(
          scheduleMailAction(
            request,
            bindOutgoingAttachmentOwner(event.sender)
          ),
          "Could not schedule email"
        ),
  payload: ScheduledMailScheduleRequest,
  result: ScheduledMailSummaryReply,
});

export const beginScheduledMailEdit = makeIpcMethod({
  channel: SCHEDULED_MAIL_BEGIN_EDIT_CHANNEL,
  handler: (request, event) =>
    event === undefined
      ? missingOwnerReply()
      : toIpcReply(
          beginScheduledMailEditAction(
            request,
            bindOutgoingAttachmentOwner(event.sender)
          ),
          "Could not open scheduled email"
        ),
  payload: ScheduledMailKey,
  result: ScheduledMailEditSessionReply,
});

export const finishScheduledMailEdit = makeIpcMethod({
  channel: SCHEDULED_MAIL_FINISH_EDIT_CHANNEL,
  handler: (request, event) =>
    event === undefined
      ? missingOwnerReply()
      : toIpcReply(
          finishScheduledMailEditAction(
            request,
            bindOutgoingAttachmentOwner(event.sender)
          ),
          "Could not update scheduled email"
        ),
  payload: ScheduledMailFinishEditRequest,
  result: ScheduledMailFinishEditReply,
});

export const cancelScheduledMailToStash = makeIpcMethod({
  channel: SCHEDULED_MAIL_CANCEL_TO_STASH_CHANNEL,
  handler: (request) =>
    toIpcReply(
      cancelScheduledMailToStashAction(request),
      "Could not cancel scheduled email"
    ),
  payload: ScheduledMailKey,
  result: ScheduledMailActionReply,
});

export const discardScheduledMail = makeIpcMethod({
  channel: SCHEDULED_MAIL_DISCARD_CHANNEL,
  handler: (request) =>
    toIpcReply(
      discardScheduledMailAction(request),
      "Could not discard scheduled email"
    ),
  payload: ScheduledMailKey,
  result: ScheduledMailActionReply,
});

export const sendScheduledMailNow = makeIpcMethod({
  channel: SCHEDULED_MAIL_SEND_NOW_CHANNEL,
  handler: (request) =>
    toIpcReply(
      sendScheduledMailNowAction(request),
      "Could not send scheduled email"
    ),
  payload: ScheduledMailSendNowRequest,
  result: ScheduledMailActionReply,
});

export const setScheduledMailOutcomeReadiness = makeIpcMethod({
  channel: SCHEDULED_MAIL_OUTCOME_READINESS_CHANNEL,
  handler: (ready, event) =>
    event === undefined
      ? missingOwnerReply()
      : toIpcReply(
          setScheduledMailOutcomeTargetReadyEffect(event.sender, ready),
          "Could not register scheduled mail feedback"
        ),
  payload: ScheduledMailOutcomeReadiness,
  result: ScheduledMailActionReply,
});
