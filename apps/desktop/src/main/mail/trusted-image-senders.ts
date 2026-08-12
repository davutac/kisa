import { gmailTrustedImageSenders } from "@repo/database/schemas";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import type {
  GmailTrustedImageSender,
  GmailTrustedImageSenderRequest,
  GmailTrustedImageSendersReply,
} from "../../shared/ipc/mail";
import { GmailTrustedImageSendersReply as GmailTrustedImageSendersReplySchema } from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";

// oxlint-disable-next-line unicorn/throw-new-error
class TrustedImageSenderError extends Schema.TaggedError<TrustedImageSenderError>()(
  "TrustedImageSenderError",
  { message: Schema.String }
) {}

// Addresses arrive from headers and from the renderer, so both sides have to
// agree on one spelling before they are compared.
const normalizeAddress = (address: string): string =>
  address.trim().toLowerCase();

export const notifyTrustedImageSendersChanged = (
  reply: GmailTrustedImageSendersReply
): void => {
  sendRendererEvent(
    MAIL_TRUSTED_IMAGE_SENDERS_CHANGED_CHANNEL,
    GmailTrustedImageSendersReplySchema,
    reply
  );
};

export const listTrustedImageSenders = Effect.fn("listTrustedImageSenders")(
  function* listTrustedImageSenders() {
    const rows = yield* withDatabaseClient((database) =>
      database.query.gmailTrustedImageSenders.findMany()
    ).pipe(
      Effect.mapError(
        () =>
          new TrustedImageSenderError({
            message: "Could not load the senders you trust with images",
          })
      )
    );

    return rows.map(
      (row) =>
        ({
          accountId: row.accountEmail,
          senderEmail: row.senderEmail,
        }) satisfies GmailTrustedImageSender
    );
  }
);

export const trustImageSender = Effect.fn("trustImageSender")(
  function* trustImageSender(request: GmailTrustedImageSenderRequest) {
    yield* withDatabaseClient((database) =>
      database
        .insert(gmailTrustedImageSenders)
        .values({
          accountEmail: normalizeAddress(request.accountId),
          createdAt: Date.now(),
          senderEmail: normalizeAddress(request.senderEmail),
        })
        .onConflictDoNothing()
        .run()
    ).pipe(
      Effect.mapError(
        () =>
          new TrustedImageSenderError({
            message: "Could not remember this sender",
          })
      )
    );

    const senders = yield* listTrustedImageSenders();

    notifyTrustedImageSendersChanged({ data: senders, ok: true });

    return senders;
  }
);

export const forgetTrustedImageSenders = Effect.fn("forgetTrustedImageSenders")(
  function* forgetTrustedImageSenders(accountId: string) {
    yield* withDatabaseClient((database) =>
      database
        .delete(gmailTrustedImageSenders)
        .where(
          eq(gmailTrustedImageSenders.accountEmail, normalizeAddress(accountId))
        )
        .run()
    ).pipe(
      Effect.mapError(
        () =>
          new TrustedImageSenderError({
            message: "Could not delete the senders you trust with images",
          })
      )
    );
  }
);
