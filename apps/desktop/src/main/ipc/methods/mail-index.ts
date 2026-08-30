import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  MAIL_INDEX_PROGRESS_CHANNEL,
  MAIL_REINDEX_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  GmailIndexProgressList,
  GmailReindexReply,
  GmailReindexRequest,
} from "../../../shared/ipc/mail";
import {
  getMailIndexProgress,
  reindexMailAccount,
} from "../../mail/mail-backfill";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const getIndexProgress = makeIpcMethod({
  channel: MAIL_INDEX_PROGRESS_CHANNEL,
  handler: () => Effect.sync(() => ({ accounts: getMailIndexProgress() })),
  payload: Schema.Void,
  result: GmailIndexProgressList,
});

export const reindexMail = makeIpcMethod({
  channel: MAIL_REINDEX_CHANNEL,
  handler: (request) =>
    toIpcReply(
      reindexMailAccount(request.accountId),
      "Could not start mail reindex"
    ),
  payload: GmailReindexRequest,
  result: GmailReindexReply,
});
