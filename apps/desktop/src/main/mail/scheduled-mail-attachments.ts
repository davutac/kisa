import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import type { OutgoingAttachment } from "@repo/gmail/models";
import { Effect, Option, Schema } from "effect";

import {
  MAX_GMAIL_ATTACHMENT_BYTES,
  MAX_GMAIL_ATTACHMENT_COUNT,
} from "../../shared/ipc/mail";
import { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";
import {
  closeOutgoingAttachment,
  decodeStoredOutgoingAttachmentsStrict,
  openOutgoingAttachment,
  readOutgoingAttachment,
} from "./outgoing-attachment-files";
import { scheduledMailAttachmentError } from "./scheduled-mail-attachment-error";
import type { ScheduledMailAttachmentError } from "./scheduled-mail-attachment-error";

const decodeFileSystemError = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.optional(Schema.String) })
);

export const decodeScheduledAttachments = Effect.fn(
  "ScheduledMailAttachments.decode"
)(function* decodeScheduledAttachments<Input>(input: Input) {
  const decoded = decodeStoredOutgoingAttachmentsStrict(input);
  if (
    decoded === undefined ||
    decoded.length > MAX_GMAIL_ATTACHMENT_COUNT ||
    decoded.some((attachment) => attachment.storage !== "app-owned") ||
    new Set(decoded.map(({ id }) => id)).size !== decoded.length
  ) {
    return yield* scheduledMailAttachmentError("attachment-invalid");
  }
  if (
    decoded.reduce((total, attachment) => total + attachment.size, 0) >
    MAX_GMAIL_ATTACHMENT_BYTES
  ) {
    return yield* scheduledMailAttachmentError("attachment-too-large");
  }
  return decoded;
});

const mapOpenError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Node file-open rejections are decoded immediately below.
  error: unknown
): ScheduledMailAttachmentError => {
  const fileSystemError = decodeFileSystemError(error);
  if (
    Option.isSome(fileSystemError) &&
    fileSystemError.value.code === "ENOENT"
  ) {
    return scheduledMailAttachmentError("attachment-missing");
  }
  return scheduledMailAttachmentError(
    error instanceof OutgoingAttachmentAuthorizationError
      ? "attachment-changed"
      : "attachment-invalid"
  );
};

const openScheduledAttachment = Effect.fn("ScheduledMailAttachments.open")(
  function* openScheduledAttachment(attachment: StoredMailDraftAttachment) {
    return yield* Effect.acquireRelease(
      Effect.tryPromise({
        catch: mapOpenError,
        try: () => openOutgoingAttachment(attachment),
      }),
      ({ file }) => Effect.promise(() => closeOutgoingAttachment(file))
    );
  }
);

const readScheduledAttachment = Effect.fn("ScheduledMailAttachments.read")(
  function* readScheduledAttachment(
    entry: Awaited<ReturnType<typeof openOutgoingAttachment>>
  ) {
    return yield* Effect.tryPromise({
      catch: (error) =>
        scheduledMailAttachmentError(
          error instanceof OutgoingAttachmentAuthorizationError
            ? "attachment-changed"
            : "attachment-invalid"
        ),
      try: () => readOutgoingAttachment(entry),
    });
  }
);

export const loadScheduledAttachmentsEffect = Effect.fn(
  "ScheduledMailAttachments.load"
)(function* loadScheduledAttachmentsEffect(
  input: readonly StoredMailDraftAttachment[]
) {
  return yield* Effect.scoped(
    Effect.gen(function* loadScheduledAttachmentsScoped() {
      const decoded = yield* decodeScheduledAttachments(input);
      const opened = yield* Effect.forEach(decoded, openScheduledAttachment, {
        concurrency: "unbounded",
      });
      const totalBytes = opened.reduce((total, entry) => total + entry.size, 0);
      if (totalBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
        return yield* scheduledMailAttachmentError("attachment-too-large");
      }
      return yield* Effect.forEach(opened, readScheduledAttachment, {
        concurrency: "unbounded",
      });
    })
  );
});

export const loadScheduledAttachments = (
  input: readonly StoredMailDraftAttachment[]
): Promise<readonly OutgoingAttachment[]> =>
  Effect.runPromise(loadScheduledAttachmentsEffect(input));
