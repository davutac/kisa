import { Effect, Option } from "effect";

import { MailProtocolError } from "./errors";
import type { MessageId } from "./ids";
import { MailEngineStore } from "./store";
import type { SyncScope } from "./sync";
import { decodeTransferEncoding } from "./text-decoding";

/** The largest attachment Kisa downloads; Gmail caps a message near 35 MB. */
export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

export interface FetchedAttachment {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mediaType: string;
}

/**
 * Downloads one attachment by its part number, only when the user opens or
 * saves it, and removes its transfer encoding. `undefined` when the message
 * or part is gone from the server.
 */
export const fetchAttachment = Effect.fn("MailAttachments.fetchAttachment")(
  function* fetchAttachment(
    scope: SyncScope,
    messageId: MessageId,
    section: string
  ) {
    const store = yield* MailEngineStore;

    const stored = yield* store.findAttachment(
      scope.accountId,
      messageId,
      section
    );

    if (Option.isNone(stored)) {
      return;
    }

    const attachment = stored.value;

    const bytes = yield* scope.session.fetchSection(
      attachment.mailboxPath,
      attachment.uidValidity,
      attachment.uid,
      attachment.section,
      MAX_ATTACHMENT_BYTES
    );

    if (bytes === undefined) {
      return;
    }

    if (bytes.byteLength >= MAX_ATTACHMENT_BYTES) {
      return yield* new MailProtocolError({
        accountId: scope.accountId,
        message: "The attachment is too large to open in Kisa",
      });
    }

    return {
      bytes: decodeTransferEncoding(bytes, attachment.encoding),
      filename: attachment.filename,
      mediaType: attachment.mediaType,
    } satisfies FetchedAttachment;
  }
);
