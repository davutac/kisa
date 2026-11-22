import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  MAIL_INDEX_PROGRESS_CHANNEL,
  MAIL_REINDEX_CHANNEL,
} from "../../../shared/ipc/channels";
import {
  MailIndexProgressList,
  MailReindexReply,
  MailReindexRequest,
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
  result: MailIndexProgressList,
});

export const reindexMail = makeIpcMethod({
  channel: MAIL_REINDEX_CHANNEL,
  handler: (request) =>
    // The engine keeps the whole account in step on its own; a reindex
    // request wakes it so it catches up now. It is the user asking, which
    // also retries a sign-in the server refused.
    toIpcReply(
      Effect.sync(() => {
        requestMailSync(request.accountId, "user");
      }),
      "Could not check for new mail"
    ),
  payload: MailReindexRequest,
  result: MailReindexReply,
});
