import { constants } from "node:fs";
import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { open, realpath } from "node:fs/promises";
import path from "node:path";

import type { StoredMailDraftAttachment } from "@repo/database/schemas";
import { Option, Schema } from "effect";

import {
  isSupportedOutgoingInlineImageMediaType,
  MAX_INLINE_IMAGE_BYTES,
} from "../../shared/attachments";
import {
  GmailOutgoingInlineContentId,
  MAX_GMAIL_ATTACHMENT_BYTES,
} from "../../shared/ipc/mail";
import type { GmailOutgoingAttachmentSelectionRequest } from "../../shared/ipc/mail";
import { OutgoingAttachmentAuthorizationError } from "./outgoing-attachment-authorization-error";

const AUTHORIZATION_VERSION = 1 as const;
const MEDIA_TYPE_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u;
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonNegativeNumber = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const MediaType = Schema.String.check(Schema.isPattern(MEDIA_TYPE_PATTERN));
const COMPOSER_INLINE_IMAGE_TAG = /<img\b(?<attributes>[^>]*)>/giu;
const COMPOSER_INLINE_IMAGE_SOURCE =
  /\bsrc\s*=\s*(?:"cid:(?<doubleQuoted>[^"]+)"|'cid:(?<singleQuoted>[^']+)')/iu;
const COMPOSER_INLINE_IMAGE_ALT =
  /\balt\s*=\s*(?:"(?<doubleQuoted>[^"]*)"|'(?<singleQuoted>[^']*)')/iu;

const StoredAuthorizedAttachment = Schema.Struct({
  authorizationVersion: Schema.Literal(AUTHORIZATION_VERSION),
  birthtimeMs: NonNegativeNumber,
  contentId: Schema.optional(GmailOutgoingInlineContentId),
  device: Schema.NonEmptyString,
  filename: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  inode: Schema.NonEmptyString,
  mediaType: MediaType,
  mtimeMs: NonNegativeNumber,
  path: Schema.NonEmptyString,
  size: NonNegativeInt,
  storage: Schema.optional(Schema.Literal("app-owned")),
});

const decodeStoredAttachment = Schema.decodeUnknownOption(
  StoredAuthorizedAttachment
);
const decodeStoredAttachmentArray = Schema.decodeUnknownOption(
  Schema.Array(Schema.Unknown)
);
const decodeStrictStoredAttachmentArray = Schema.decodeUnknownOption(
  Schema.Array(StoredAuthorizedAttachment)
);
const isGmailOutgoingInlineContentId = Schema.is(GmailOutgoingInlineContentId);
const decodeFileSystemError = Schema.decodeUnknownOption(
  Schema.Struct({ code: Schema.optional(Schema.String) })
);
/* oxlint-disable eslint/no-bitwise -- Node open flags are bit masks. */
const SAFE_READ_FLAGS =
  constants.O_RDONLY |
  (process.platform === "win32"
    ? 0
    : constants.O_NONBLOCK | constants.O_NOFOLLOW);
/* oxlint-enable eslint/no-bitwise */

export interface OpenedOutgoingAttachment {
  readonly file: FileHandle;
  readonly record: StoredMailDraftAttachment;
  readonly size: number;
}

export interface LoadedOutgoingAttachment {
  readonly bytes: Uint8Array;
  readonly contentId?: string;
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
        if (
          selection.mediaType.length > 0 &&
          !MEDIA_TYPE_PATTERN.test(selection.mediaType)
        ) {
          throw authorizationError("Attachment media type is invalid");
        }
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

export const decodeStoredOutgoingAttachmentEntries = <Input>(
  input: Input
): readonly (StoredMailDraftAttachment | undefined)[] | undefined => {
  const values = decodeStoredAttachmentArray(input);
  if (Option.isNone(values)) {
    return;
  }
  return values.value.map((value) =>
    Option.getOrUndefined(decodeStoredAttachment(value))
  );
};

export const decodeStoredOutgoingAttachmentsStrict = <Input>(
  input: Input
): readonly StoredMailDraftAttachment[] | undefined =>
  Option.getOrUndefined(decodeStrictStoredAttachmentArray(input));

const decodeComposerAttribute = (value: string): string =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

// App-owned copies created by older scheduling builds lost contentId. The
// composer HTML still owns the original cid-to-filename association, so each
// matching supported attachment can be restored at most once.
export const recoverMissingInlineContentIds = (
  bodyHtml: string,
  attachments: readonly StoredMailDraftAttachment[]
): readonly StoredMailDraftAttachment[] => {
  const recovered = [...attachments];
  const assignedContentIds = new Set(
    attachments.flatMap(({ contentId }) =>
      contentId === undefined ? [] : [contentId]
    )
  );
  const assignedAttachmentIndexes = new Set<number>();

  for (const tag of bodyHtml.matchAll(COMPOSER_INLINE_IMAGE_TAG)) {
    const attributes = tag.groups?.attributes ?? "";
    const source = COMPOSER_INLINE_IMAGE_SOURCE.exec(attributes);
    const contentId =
      source?.groups?.doubleQuoted ?? source?.groups?.singleQuoted;
    const alt = COMPOSER_INLINE_IMAGE_ALT.exec(attributes);
    const filename = alt?.groups?.doubleQuoted ?? alt?.groups?.singleQuoted;
    if (
      contentId === undefined ||
      filename === undefined ||
      !isGmailOutgoingInlineContentId(contentId) ||
      assignedContentIds.has(contentId)
    ) {
      continue;
    }
    const attachmentIndex = recovered.findIndex(
      (attachment, index) =>
        !assignedAttachmentIndexes.has(index) &&
        attachment.contentId === undefined &&
        attachment.filename === decodeComposerAttribute(filename) &&
        isSupportedOutgoingInlineImageMediaType(attachment.mediaType) &&
        attachment.size <= MAX_INLINE_IMAGE_BYTES
    );
    const attachment = recovered[attachmentIndex];
    if (attachment === undefined) {
      continue;
    }
    recovered[attachmentIndex] = { ...attachment, contentId };
    assignedAttachmentIndexes.add(attachmentIndex);
    assignedContentIds.add(contentId);
  }

  return recovered;
};

export const openOutgoingAttachment = async (
  record: StoredMailDraftAttachment
): Promise<OpenedOutgoingAttachment> => {
  let file: FileHandle;
  try {
    file = await open(record.path, SAFE_READ_FLAGS);
  } catch (error) {
    const fileSystemError = decodeFileSystemError(error);
    if (
      Option.isSome(fileSystemError) &&
      fileSystemError.value.code === "ENOENT"
    ) {
      throw error;
    }
    throw authorizationError(`Could not read attachment: ${record.filename}`);
  }
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
    contentId: entry.record.contentId,
    filename: entry.record.filename,
    mediaType: entry.record.mediaType,
  };
};
