import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailInlineImages, mailMessages } from "@repo/database/schemas";
import { and, eq, lt, sql } from "drizzle-orm";

import { inJson } from "./mail-database";

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface InlineImagePart {
  readonly messageId: string;
  /** The IMAP section the image is fetched from. */
  readonly section: string;
}

export interface CachedInlineImage extends InlineImagePart {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export interface KeptInlineImage extends CachedInlineImage {
  /** When it was last shown, in epoch milliseconds. */
  readonly usedAt: number;
}

export const toInlineImageKey = ({
  messageId,
  section,
}: InlineImagePart): string => `${messageId}\u0000${section}`;

/** The account's kept images for the given messages, by `toInlineImageKey`. */
export const readCachedInlineImages = async (
  database: RemoteDatabaseClient,
  accountId: string,
  messageIds: readonly string[]
): Promise<ReadonlyMap<string, KeptInlineImage>> => {
  if (messageIds.length === 0) {
    return new Map();
  }

  const rows = await database
    .select({
      bytes: mailInlineImages.data,
      mediaType: mailInlineImages.mediaType,
      messageId: mailInlineImages.messageId,
      section: mailInlineImages.section,
      usedAt: mailInlineImages.usedAt,
    })
    .from(mailInlineImages)
    .where(
      and(
        eq(mailInlineImages.accountId, accountId),
        inJson(mailInlineImages.messageId, [...new Set(messageIds)])
      )
    )
    .all();

  return new Map(rows.map((row) => [toInlineImageKey(row), row]));
};

/**
 * Keeps fetched images. An image whose message has left the cache while it
 * was being fetched is not kept, so no row outlives its message.
 */
export const saveInlineImages = async (
  database: RemoteDatabaseClient,
  accountId: string,
  images: readonly CachedInlineImage[],
  now: number
): Promise<void> => {
  for (const image of images) {
    // A handful of images per conversation, each its own blob parameter.
    // oxlint-disable-next-line eslint/no-await-in-loop
    await database.run(sql`
      INSERT OR IGNORE INTO ${mailInlineImages}
        (account_id, message_id, section, media_type, data, used_at)
      SELECT ${accountId}, ${image.messageId}, ${image.section},
        ${image.mediaType}, ${image.bytes}, ${now}
      WHERE EXISTS (
        SELECT 1 FROM ${mailMessages}
        WHERE ${mailMessages.accountId} = ${accountId}
          AND ${mailMessages.messageId} = ${image.messageId}
      )
    `);
  }
};

/**
 * Whether kept images were shown long enough ago to record showing them
 * again. Recording at most once a day keeps opening mail from writing.
 */
export const isInlineImageUseStale = (usedAt: number, now: number): boolean =>
  usedAt < now - DAY_MS;

/** Records that the messages' kept images were shown. */
export const markInlineImagesUsed = async (
  database: RemoteDatabaseClient,
  accountId: string,
  messageIds: readonly string[],
  now: number
): Promise<void> => {
  await database
    .update(mailInlineImages)
    .set({ usedAt: now })
    .where(
      and(
        eq(mailInlineImages.accountId, accountId),
        inJson(mailInlineImages.messageId, [...new Set(messageIds)]),
        lt(mailInlineImages.usedAt, now - DAY_MS)
      )
    )
    .run();
};

/** Removes the account's images not shown since `usedBefore`. */
export const clearUnusedInlineImages = async (
  database: RemoteDatabaseClient,
  accountId: string,
  usedBefore: number
): Promise<void> => {
  await database
    .delete(mailInlineImages)
    .where(
      and(
        eq(mailInlineImages.accountId, accountId),
        lt(mailInlineImages.usedAt, usedBefore)
      )
    )
    .run();
};

export interface InlineImageClearing {
  readonly at: number;
  readonly retentionDays: number;
}

/**
 * An account's unused images are cleared once a day, and at once when the
 * user shortens or lengthens how long they are kept. `null` keeps them.
 */
export const isInlineImageClearingDue = (
  last: InlineImageClearing | undefined,
  retentionDays: number | null,
  now: number
): retentionDays is number =>
  retentionDays !== null &&
  (last === undefined ||
    last.retentionDays !== retentionDays ||
    now - last.at >= DAY_MS);
