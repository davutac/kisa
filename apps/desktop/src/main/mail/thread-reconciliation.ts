import type { GmailEntityNotFoundError } from "@repo/gmail/errors";
import { Effect } from "effect";

import { MAIL_THREAD_LIST_UPDATED_CHANNEL } from "../../shared/ipc/channels";
import { GmailThreadListUpdated } from "../../shared/ipc/mail";
import { sendRendererEvent } from "../electron/renderer-events";
import { refreshUnreadBadge } from "./unread-badge";

export const publishThreadReconciliation = Effect.fn(
  "publishThreadReconciliation"
)(function* publishThreadReconciliation(
  accountId: string,
  reconciliation: NonNullable<GmailEntityNotFoundError["reconciledThread"]>
) {
  yield* Effect.sync(() =>
    sendRendererEvent(
      MAIL_THREAD_LIST_UPDATED_CHANNEL,
      GmailThreadListUpdated,
      {
        changes: [
          reconciliation.outcome === "removed"
            ? {
                accountId,
                kind: "remove",
                threadId: reconciliation.threadId,
              }
            : { accountId, kind: "reload" },
        ],
      }
    )
  );
  yield* refreshUnreadBadge().pipe(
    Effect.catch((error) =>
      Effect.logWarning(`Could not refresh unread badge: ${error.message}`)
    )
  );
});

export const publishReconciledGmailError = Effect.fn(
  "publishReconciledGmailError"
)(
  // Effect.fn uses a generator callback, not a Promise callback.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  function* publishReconciledGmailError(error: GmailEntityNotFoundError) {
    if (error.reconciledThread !== undefined) {
      yield* publishThreadReconciliation(
        error.accountId,
        error.reconciledThread
      );
    }
  }
);
