import { randomUUID } from "node:crypto";

import { Effect } from "effect";
import { net } from "electron";

import { accountMailWorkSupervisor } from "./account-mail-work-supervisor";
import {
  bestEffortDraftAttachmentCleanup,
  getOptionalDraftAttachmentStore,
} from "./draft-attachment-store";
import {
  deliverNewMessage,
  findSentNewMessageByRfc822MessageId,
  MailSyncError,
} from "./mail-sync";
import { decodeStoredOutgoingAttachmentsStrict } from "./outgoing-attachment-files";
import { loadScheduledAttachments } from "./scheduled-mail-attachments";
import {
  makeDatabaseScheduledMailWorkerStore,
  withScheduledMailDatabase,
} from "./scheduled-mail-database";
import { showScheduledMailNotification } from "./scheduled-mail-notifications";
import { ScheduledMailWorker } from "./scheduled-mail-worker";
import type {
  ScheduledMailDeliveryFailure,
  ScheduledMailKey,
  ScheduledMailWorkerDependencies,
} from "./scheduled-mail-worker";

interface ScheduledMailDeliveryOptions {
  readonly notifyChanged: (
    key: ScheduledMailKey,
    kind: "remove" | "upsert"
  ) => void;
  readonly withKeyLock: ScheduledMailWorkerDependencies["withKeyLock"];
}

const deleteSentAttachmentCopies = Effect.fn("deleteSentAttachmentCopies")(
  function* deleteSentAttachmentCopies(draftId: string) {
    const store = getOptionalDraftAttachmentStore();
    if (store === undefined) {
      return;
    }
    const attachments = yield* withScheduledMailDatabase(async (database) => {
      const draft = await database.query.mailDrafts.findFirst({
        columns: { attachments: true },
        where: { id: draftId },
      });
      return decodeStoredOutgoingAttachmentsStrict(draft?.attachments) ?? [];
    });
    yield* bestEffortDraftAttachmentCleanup(store.delete(attachments));
    yield* bestEffortDraftAttachmentCleanup(store.deleteDraft(draftId));
  }
);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This catch boundary narrows adapter failures to the durable delivery failure union.
const toDeliveryFailure = (error: unknown): ScheduledMailDeliveryFailure => {
  if (!(error instanceof MailSyncError)) {
    return { kind: "outcome-unknown" };
  }
  switch (error.kind) {
    case "rate-limited": {
      return error.retryAfterMs === undefined
        ? { kind: "rate-limited" }
        : { kind: "rate-limited", retryAfterMs: error.retryAfterMs };
    }
    case "account-action-required":
    case "delivery-rejected":
    case "message-invalid":
    case "outcome-unknown": {
      return { kind: error.kind };
    }
    default: {
      return { kind: "outcome-unknown" };
    }
  }
};

export const createScheduledMailDelivery = ({
  notifyChanged,
  withKeyLock,
}: ScheduledMailDeliveryOptions) => {
  const store = makeDatabaseScheduledMailWorkerStore({
    notifyChanged,
    withKeyLock,
  });
  const worker = new ScheduledMailWorker(store, {
    deliver: async (item, attachments, signal) => {
      try {
        await Effect.runPromise(
          deliverNewMessage(
            {
              accountId: item.accountId,
              bcc: item.bcc,
              body: item.body,
              cc: item.cc,
              rfc822MessageId: item.rfcMessageId,
              subject: item.subject,
              to: item.to,
            },
            attachments
          ),
          { signal }
        );
        return { ok: true as const };
      } catch (error) {
        return { error: toDeliveryFailure(error), ok: false as const };
      }
    },
    isOnline: () => net.isOnline(),
    loadAttachments: loadScheduledAttachments,
    notify: async (notification) => {
      if (notification.kind === "sent") {
        await Effect.runPromise(
          deleteSentAttachmentCopies(notification.draftId).pipe(Effect.ignore)
        );
      }
      await showScheduledMailNotification(notification);
    },
    now: Date.now,
    randomId: randomUUID,
    reconcile: async (item, signal) => {
      try {
        const sent = await Effect.runPromise(
          findSentNewMessageByRfc822MessageId(
            item.accountId,
            item.rfcMessageId
          ),
          { signal }
        );
        return sent === undefined
          ? { kind: "missing" as const }
          : { kind: "found" as const };
      } catch (error) {
        return error instanceof MailSyncError &&
          error.retryAfterMs !== undefined
          ? { kind: "defer" as const, retryAfterMs: error.retryAfterMs }
          : { kind: "defer" as const };
      }
    },
    runAccountWork: (accountId, work, parentSignal) =>
      accountMailWorkSupervisor.run(accountId, work, parentSignal),
    schedule: (run, delayMs) => {
      const timer = setTimeout(run, delayMs);
      timer.unref();
      return { cancel: () => clearTimeout(timer) };
    },
    withKeyLock,
  });
  return { store, worker };
};
