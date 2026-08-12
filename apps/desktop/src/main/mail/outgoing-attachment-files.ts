import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { Option, Schema } from "effect";

import { MAX_GMAIL_ATTACHMENT_BYTES } from "../../shared/ipc/mail";
import type { GmailOutgoingAttachmentSelectionRequest } from "../../shared/ipc/mail";
import { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";

const AUTHORIZATION_VERSION = 1 as const;
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

const StoredAuthorizedAttachment = Schema.Struct({
  authorizationVersion: Schema.Literal(AUTHORIZATION_VERSION),
  birthtimeMs: NonNegativeNumber,
  device: Schema.NonEmptyString,
  filename: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  inode: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
  mtimeMs: NonNegativeNumber,
  path: Schema.NonEmptyString,
  size: NonNegativeInt,
});

const decodeStoredAttachment = Schema.decodeUnknownOption(
  StoredAuthorizedAttachment
);
const decodeStoredAttachmentArray = Schema.decodeUnknownOption(
  Schema.Array(Schema.Unknown)
);

export interface OpenedOutgoingAttachment {
  readonly file: FileHandle;
  readonly record: StoredMailDraftAttachment;
  readonly size: number;
}

export interface LoadedOutgoingAttachment {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mediaType: string;
}

const authorizationError = (
  message: string
): OutgoingAttachmentAuthorizationError =>
  new OutgoingAttachmentAuthorizationError({ message });

export const closeOutgoingAttachment = async (
  file: FileHandle
): Promise<void> => {
  try {
    await file.close();
  } catch {
    // The authorization is already unusable; cleanup must not mask that result.
  }
};

const isSameFile = (record: StoredMailDraftAttachment, stats: Stats): boolean =>
  stats.isFile() &&
  stats.birthtimeMs === record.birthtimeMs &&
  String(stats.dev) === record.device &&
  String(stats.ino) === record.inode &&
  stats.mtimeMs === record.mtimeMs &&
  stats.size === record.size;

export const authorizeOutgoingAttachmentFiles = async (
  selections: GmailOutgoingAttachmentSelectionRequest["files"],
  randomId: () => string
): Promise<readonly StoredMailDraftAttachment[]> => {
  const records = await Promise.all(
    selections.map(async (selection) => {
      let file: FileHandle | undefined;
      try {
        const canonicalPath = await realpath(selection.path);
        file = await open(canonicalPath, "r");
        const stats = await file.stat();
        if (!stats.isFile()) {
          throw authorizationError("Only regular files can be attached");
        }
        return {
          authorizationVersion: AUTHORIZATION_VERSION,
          birthtimeMs: stats.birthtimeMs,
          device: String(stats.dev),
          filename: path.basename(canonicalPath) || "attachment",
          id: randomId(),
          inode: String(stats.ino),
          mediaType:
            selection.mediaType.length === 0
              ? "application/octet-stream"
              : selection.mediaType,
          mtimeMs: stats.mtimeMs,
          path: canonicalPath,
          size: stats.size,
        } satisfies StoredMailDraftAttachment;
      } catch (error) {
        if (error instanceof OutgoingAttachmentAuthorizationError) {
          throw error;
        }
        throw authorizationError("Could not authorize the selected attachment");
      } finally {
        if (file !== undefined) {
          await closeOutgoingAttachment(file);
        }
      }
    })
  );
  const totalBytes = records.reduce((total, record) => total + record.size, 0);
  if (totalBytes > MAX_GMAIL_ATTACHMENT_BYTES) {
    throw authorizationError("Attachments can total up to 25 MB");
  }
  return records;
};

export const decodeStoredOutgoingAttachments = <Input>(
  input: Input
): readonly StoredMailDraftAttachment[] => {
  const values = decodeStoredAttachmentArray(input);
  if (Option.isNone(values)) {
    return [];
  }
  return values.value.flatMap((value) => {
    const decoded = decodeStoredAttachment(value);
    return Option.isSome(decoded) ? [decoded.value] : [];
  });
};

export const openOutgoingAttachment = async (
  record: StoredMailDraftAttachment
): Promise<OpenedOutgoingAttachment> => {
  const file = await open(record.path, "r");
  try {
    const stats = await file.stat();
    if (!isSameFile(record, stats)) {
      throw authorizationError(`Could not read attachment: ${record.filename}`);
    }
    return { file, record, size: stats.size };
  } catch (error) {
    await closeOutgoingAttachment(file);
    throw error;
  }
};

export const readOutgoingAttachment = async (
  entry: OpenedOutgoingAttachment
): Promise<LoadedOutgoingAttachment> => {
  const buffer = Buffer.allocUnsafe(entry.size + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    // oxlint-disable-next-line no-await-in-loop -- A bounded descriptor read advances one buffer position at a time.
    const { bytesRead } = await entry.file.read(
      buffer,
      offset,
      buffer.byteLength - offset,
      null
    );
    if (bytesRead === 0) {
      break;
    }
    offset += bytesRead;
  }
  const stats = await entry.file.stat();
  if (offset !== entry.size || !isSameFile(entry.record, stats)) {
    throw authorizationError(
      `Attachment changed while sending: ${entry.record.filename}`
    );
  }
  return {
    bytes: buffer.subarray(0, offset),
    filename: entry.record.filename,
    mediaType: entry.record.mediaType,
  };
};
