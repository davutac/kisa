import { randomUUID } from "node:crypto";

import { Cause, Effect, Exit, Result } from "effect";
import { net } from "electron";

import { accountMailWorkSupervisor } from "./account-mail-work-supervisor";
import {
  bestEffortDraftAttachmentCleanup,
  getOptionalDraftAttachmentStore,
} from "./draft-attachment-store";
import { runEngineExit } from "./engine/mail-engine";
import { findSentMessage, sendNewMessage } from "./engine/mail-send";
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

/** The engine's failure, if the send failed with one. */
const failureOf = <A, E>(exit: Exit.Exit<A, E>): E | undefined => {
  if (Exit.isSuccess(exit)) {
    return;
  }

  const found = Cause.findError(exit.cause);

  return Result.isSuccess(found) ? found.success : undefined;
};

type SendFailure = ReturnType<
  typeof failureOf<unknown, Effect.Error<ReturnType<typeof sendNewMessage>>>
>;

/**
 * What a failed send means for the scheduled message. Only a failure that
 * may have delivered it is "outcome unknown", which looks in sent mail
 * before anything is sent again; a failure before the hand-over is retried.
 */
const toDeliveryFailure = (
  failure: SendFailure
): ScheduledMailDeliveryFailure => {
  switch (failure?._tag) {
    case "MailAuthError":
    case "MailEngineError": {
      return { kind: "account-action-required" };
    }

    // A store failure happens only before the message is handed to the
    // mail server: reading the account and its sender. Nothing was sent.
    case "MailConnectionError":
    case "MailStoreError": {
      return { kind: "rate-limited" };
    }

    case "MailThrottledError": {
      return failure.retryAfterMs === undefined
        ? { kind: "rate-limited" }
        : { kind: "rate-limited", retryAfterMs: failure.retryAfterMs };
    }

    case "MailSendRejectedError": {
      return { kind: "delivery-rejected" };
    }

    case "MailProtocolError": {
      return { kind: "message-invalid" };
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
      const exit = await runEngineExit(
        sendNewMessage({
          accountId: item.accountId,
          attachments,
          bcc: item.bcc,
          body: item.body,
          cc: item.cc,
          rfc822MessageId: item.rfcMessageId,
          subject: item.subject,
          to: item.to,
        }),
        { signal }
      );

      return Exit.isSuccess(exit)
        ? { ok: true as const }
        : { error: toDeliveryFailure(failureOf(exit)), ok: false as const };
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
      const exit = await runEngineExit(
        findSentMessage(item.accountId, item.rfcMessageId),
        { signal }
      );

      if (Exit.isSuccess(exit)) {
        return exit.value
          ? { kind: "found" as const }
          : { kind: "missing" as const };
      }

      const failure = failureOf(exit);

      // A refused sign-in or an account that is gone will not let the look
      // be made by waiting. The outcome stays unknown, and the user is asked.
      if (
        failure?._tag === "MailAuthError" ||
        failure?._tag === "MailEngineError"
      ) {
        return { kind: "missing" as const };
      }

      return failure?._tag === "MailThrottledError" &&
        failure.retryAfterMs !== undefined
        ? { kind: "defer" as const, retryAfterMs: failure.retryAfterMs }
        : { kind: "defer" as const };
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
