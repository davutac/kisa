import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/**
 * A server mailbox and what the cache knows of it. Mod-sequences and
 * UIDVALIDITY are 64-bit, so they are kept as decimal text.
 */
export const mailMailboxes = sqliteTable(
  "mail_mailboxes",
  {
    accountId: text("account_id").notNull(),
    delimiter: text("delimiter").notNull(),
    /**
     * Without CONDSTORE, flags are refreshed a slice of cached copies at a
     * time, newest first: the next slice starts below this UID. `null` means
     * the next slice starts below the newest copies, which every pass reads.
     */
    flagCursor: integer("flag_cursor"),
    /** HIGHESTMODSEQ when the cache last caught up, absent without CONDSTORE. */
    highestModseq: text("highest_modseq"),
    /** The message count the cache last saw, for spotting deletions. */
    messageCount: integer("message_count"),
    path: text("path").notNull(),
    role: text("role").notNull(),
    selectable: integer("selectable", { mode: "boolean" }).notNull(),
    /**
     * Every UID at or above this one has cached metadata. The skeleton walks
     * it down to 1; `null` means the walk has not started.
     */
    skeletonFloor: integer("skeleton_floor"),
    /** Whether the engine reads this mailbox's messages (the dialect decides). */
    synced: integer("synced", { mode: "boolean" }).notNull(),
    /** UIDNEXT when the cache last caught up with new mail. */
    uidNext: integer("uid_next"),
    uidValidity: text("uid_validity"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.path] })]
);
