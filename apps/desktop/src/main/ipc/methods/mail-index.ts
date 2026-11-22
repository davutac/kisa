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
  getMailEngineIndexProgress,
  requestMailSync,
} from "../../mail/engine/mail-engine";
import { makeIpcMethod } from "../desktop-ipc";
import { toIpcReply } from "../reply";

export const getIndexProgress = makeIpcMethod({
  channel: MAIL_INDEX_PROGRESS_CHANNEL,
  handler: () =>
    Effect.sync(() => ({ accounts: getMailEngineIndexProgress() })),
  payload: Schema.Void,
  result: GmailIndexProgressList,
});

export const reindexMail = makeIpcMethod({
  channel: MAIL_REINDEX_CHANNEL,
  handler: (request) =>
    // The engine keeps the whole account in step on its own; a reindex
    // request wakes it so it catches up now.
    toIpcReply(
      Effect.sync(() => {
        requestMailSync(request.accountId);
      }),
      "Could not check for new mail"
    ),
  payload: GmailReindexRequest,
  result: GmailReindexReply,
});
