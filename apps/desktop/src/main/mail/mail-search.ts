import type { DatabaseClient } from "@repo/database/client";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type {
  GmailSearchFilter,
  GmailSearchRequest,
  GmailSearchResults,
  GmailSenderSuggestion,
  GmailSenderSuggestionRequest,
  GmailSenderSuggestions,
  GmailThreadSummary,
} from "../../shared/ipc/mail";
import { getDatabaseClient } from "../database";
import { toContainsPattern, toFtsMatchQuery } from "./search-match";

const DEFAULT_RESULT_LIMIT = 50;
const MAX_RESULT_LIMIT = 200;
const DEFAULT_SENDER_LIMIT = 8;
const MAX_SENDER_LIMIT = 50;

/**
 * A prefix query typed one letter at a time ("i", "in", "inv") matches a large
 * share of a full mailbox on its way to being specific, and the palette only
 * shows the newest handful. Bounding the message scan keeps the broad
 * intermediate queries cheap; the cap takes the newest matches, which is the
 * order results are shown in anyway.
 */
const MAX_MATCHED_MESSAGES = 5000;

// oxlint-disable-next-line unicorn/throw-new-error
class MailSearchError extends Schema.TaggedErrorClass<MailSearchError>()(
  "MailSearchError",
  { message: Schema.String }
) {}

const withDatabase = <A>(
  message: string,
  run: (database: Effect.Success<ReturnType<typeof getDatabaseClient>>) => A
) =>
  getDatabaseClient().pipe(
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    Effect.mapError((error) => new MailSearchError({ message: error.message })),
    Effect.flatMap((database) =>
      Effect.try({
        catch: () => new MailSearchError({ message }),
        try: () => run(database),
      })
    )
  );

/**
 * Raw statements bypass Drizzle's column mapping, so JSON columns arrive as the
 * text SQLite stores rather than as parsed arrays.
 */
interface SearchThreadRow {
  readonly account_email: string;
  readonly attachments: string | null;
  readonly from: string;
  readonly has_attachments: number | null;
  readonly is_unread: number;
  readonly labels: string | null;
  readonly latest_at: number;
  readonly message_count: number;
  readonly snippet: string;
  readonly subject: string;
  readonly thread_id: string;
}

interface SenderRow {
  readonly address: string;
  readonly message_count: number;
  readonly name: string | null;
}

const parseJsonArray = <A>(value: string | null): readonly A[] => {
  if (value === null) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return Array.isArray(parsed) ? (parsed as readonly A[]) : [];
  } catch {
    return [];
  }
};

const toThreadSummary = (row: SearchThreadRow): GmailThreadSummary => {
  const attachments = parseJsonArray<GmailThreadSummary["attachments"][number]>(
    row.attachments
  );

  return {
    accountId: row.account_email,
    attachments,
    from: row.from,
    hasAttachments:
      row.has_attachments === null
        ? attachments.length > 0
        : row.has_attachments === 1,
    isUnread: row.is_unread === 1,
    labels: parseJsonArray<string>(row.labels),
    latestAt: row.latest_at,
    messageCount: row.message_count,
    snippet: row.snippet,
    subject: row.subject,
    threadId: row.thread_id,
  };
};

const clampLimit = (
  limit: number | undefined,
  fallback: number,
  max: number
) => (limit === undefined ? fallback : Math.min(Math.max(1, limit), max));

const toAccountList = (accountIds: readonly string[]): SQL =>
  sql.join(
    accountIds.map((accountId) => sql`${accountId}`),
    sql`, `
  );

/**
 * Filters that pick out messages inside a thread. A thread matches when any one
 * of its messages does, which is what makes `from:` find a conversation the
 * sender only replied to.
 */
const toMessageConditions = (
  filters: readonly GmailSearchFilter[]
): readonly SQL[] =>
  filters.flatMap((filter) => {
    const pattern = toContainsPattern(filter.value);

    if (filter.field === "from") {
      return [
        sql`(m.from_address LIKE ${pattern} ESCAPE '\\' OR coalesce(m.from_name, '') LIKE ${pattern} ESCAPE '\\')`,
      ];
    }

    if (filter.field === "to") {
      return [
        sql`EXISTS (SELECT 1 FROM json_each(coalesce(m.to_addresses, '[]')) WHERE json_each.value LIKE ${pattern} ESCAPE '\\')`,
      ];
    }

    return filter.field === "subject"
      ? [sql`m.subject LIKE ${pattern} ESCAPE '\\'`]
      : [];
  });

/** Filters the cached thread row already answers, so no message scan is needed. */
const toThreadConditions = (
  filters: readonly GmailSearchFilter[]
): readonly SQL[] =>
  filters.flatMap((filter) => {
    if (filter.field === "is") {
      const value = filter.value.toLowerCase();

      if (value === "unread") {
        return [sql`t.is_unread = 1`];
      }

      return value === "read" ? [sql`t.is_unread = 0`] : [];
    }

    return filter.field === "has" &&
      filter.value.toLowerCase().startsWith("attach")
      ? [sql`t.has_attachments = 1`]
      : [];
  });

const andAll = (conditions: readonly SQL[]): SQL =>
  conditions.length === 0
    ? sql``
    : sql` AND ${sql.join([...conditions], sql` AND `)}`;

/**
 * Column weights for `bm25`, in the order `gmail_messages_fts` declares them.
 * A word in the subject or the sender says far more about what a message is
 * than the same word somewhere in a quoted reply chain, so those columns carry
 * the ranking and the body only separates messages that tie on them.
 */
const SUBJECT_WEIGHT = 10;
const SENDER_WEIGHT = 6;
const BODY_WEIGHT = 1;

/**
 * How much staleness can cost a thread, and the age at which half of that cost
 * applies. Measured on a real mailbox: for a one-word query nearly every
 * subject hit scores within 0.1 of the best, so relevance alone leaves the
 * order to chance — it was surfacing test mail from six months ago above this
 * week's. A gap this size still beats age (a body-only hit scores ~3 worse than
 * a subject hit, more than the 4-point penalty can bridge in either direction),
 * so relevance decides what matters and recency decides the ties.
 */
const RECENCY_PENALTY = 4;
const RECENCY_SPAN_MS = 90 * 86_400_000;

/** Lower is a better match: `bm25` returns a negative score. */
const BM25_SCORE = sql`bm25(gmail_messages_fts, ${sql.raw(String(SUBJECT_WEIGHT))}, ${sql.raw(String(SENDER_WEIGHT))}, ${sql.raw(String(BODY_WEIGHT))})`;

interface MatchedThreads {
  /** True when the rows carry a relevance score worth ordering by. */
  isRanked: boolean;
  sql: SQL;
}

/**
 * The matched-message set is materialised on purpose: left inline, SQLite is
 * free to re-run the full-text query once per candidate thread row, which turns
 * one index lookup into thousands.
 *
 * A thread is scored by its best-matching message, so a long conversation is
 * not punished for the messages in it that say nothing about the query.
 */
const toMatchedThreadsCte = (
  accounts: SQL,
  matchQuery: string | undefined,
  messageConditions: readonly SQL[]
): MatchedThreads | undefined => {
  if (matchQuery === undefined && messageConditions.length === 0) {
    return undefined;
  }

  // Text queries keep the best-scoring messages when the scan is capped;
  // filter-only queries have no scores, so they keep the newest.
  const scored =
    matchQuery === undefined
      ? {
          order: sql`m.internal_date DESC`,
          score: sql`0`,
          source: sql`FROM gmail_messages m WHERE m.account_email IN (${accounts})`,
        }
      : {
          order: sql`score ASC`,
          score: BM25_SCORE,
          source: sql`FROM gmail_messages_fts
            JOIN gmail_messages m ON m.rowid = gmail_messages_fts.rowid
            WHERE gmail_messages_fts MATCH ${matchQuery}
              AND m.account_email IN (${accounts})`,
        };

  return {
    isRanked: matchQuery !== undefined,
    sql: sql`WITH matched AS MATERIALIZED (
      SELECT account_email, thread_id, min(score) AS score FROM (
        SELECT m.account_email AS account_email,
               m.thread_id AS thread_id,
               ${scored.score} AS score
        ${scored.source}${andAll(messageConditions)}
        ORDER BY ${scored.order}
        LIMIT ${MAX_MATCHED_MESSAGES}
      )
      GROUP BY account_email, thread_id
    )`,
  };
};

/**
 * Searches the local mail index rather than Gmail: results are instant, work
 * offline, cost no quota, and cover everything the backfill has walked — which
 * is the whole account, not just the inbox.
 *
 * Takes the client rather than reaching for it, so the statement can be run
 * against a real migrated database in tests.
 */
export const runIndexedThreadSearch = (
  database: DatabaseClient,
  request: GmailSearchRequest
): GmailSearchResults => {
  const limit = clampLimit(
    request.limit,
    DEFAULT_RESULT_LIMIT,
    MAX_RESULT_LIMIT
  );

  if (request.accountIds.length === 0) {
    return { hasMore: false, threads: [] };
  }

  const filters = request.filters ?? [];
  const accounts = toAccountList(request.accountIds);
  const matched = toMatchedThreadsCte(
    accounts,
    toFtsMatchQuery(request.text ?? ""),
    toMessageConditions(filters)
  );
  // Words are a question about relevance, answered by rank against a mild age
  // penalty; filters alone are a question about a mailbox, answered by date.
  const order =
    matched?.isRanked === true
      ? sql`matched.score + ${RECENCY_PENALTY} * (1.0 - 1.0 / (1.0 + max(0, ${Date.now()} - t.latest_at) * 1.0 / ${RECENCY_SPAN_MS})) ASC, t.latest_at DESC`
      : sql`t.latest_at DESC`;
  const rows = database.all<SearchThreadRow>(sql`
    ${matched?.sql ?? sql``}
    SELECT t.account_email, t.attachments, t."from", t.has_attachments,
           t.is_unread, t.labels, t.latest_at, t.message_count,
           t.snippet, t.subject, t.thread_id
    FROM gmail_threads t
    ${
      matched === undefined
        ? sql``
        : sql`JOIN matched ON matched.account_email = t.account_email
              AND matched.thread_id = t.thread_id`
    }
    WHERE t.account_email IN (${accounts})${andAll(toThreadConditions(filters))}
    ORDER BY ${order}, t.account_email ASC, t.thread_id ASC
    LIMIT ${limit + 1}
  `);

  return {
    hasMore: rows.length > limit,
    threads: rows.slice(0, limit).map(toThreadSummary),
  };
};

/**
 * Recipients come from this account's *sent* mail only. `to_addresses` is a
 * JSON array with no index of its own, so the scan has to be narrowed by
 * something that does have one: `(account_email, from_address)` picks out the
 * messages this account wrote, which is a small slice of a mailbox — and it is
 * exactly the set `to:` is asking about.
 */
const toRecipientStatement = (
  accounts: SQL,
  pattern: SQL,
  limit: number
): SQL => sql`
  SELECT recipient.value AS address, '' AS name, count(*) AS message_count
  FROM gmail_messages m
  JOIN json_each(coalesce(m.to_addresses, '[]')) AS recipient
  WHERE m.account_email IN (${accounts})
    AND m.from_address IN (${accounts})${pattern}
  GROUP BY lower(recipient.value)
  ORDER BY message_count DESC, address ASC
  LIMIT ${limit}
`;

const toSenderStatement = (accounts: SQL, pattern: SQL, limit: number): SQL =>
  sql`
    SELECT m.from_address AS address,
           max(coalesce(m.from_name, '')) AS name,
           count(*) AS message_count
    FROM gmail_messages m
    WHERE m.account_email IN (${accounts})${pattern}
    GROUP BY lower(m.from_address)
    ORDER BY message_count DESC, address ASC
    LIMIT ${limit}
  `;

/**
 * The addresses behind a `from:` or `to:` pill, ranked by how much mail they
 * account for — the address someone means is nearly always one they exchange
 * mail with often.
 */
export const runSenderSuggestions = (
  database: DatabaseClient,
  request: GmailSenderSuggestionRequest
): GmailSenderSuggestions => {
  const limit = clampLimit(
    request.limit,
    DEFAULT_SENDER_LIMIT,
    MAX_SENDER_LIMIT
  );
  const query = request.query?.trim() ?? "";

  if (request.accountIds.length === 0) {
    return { senders: [] };
  }

  const isRecipient = request.role === "recipient";
  const like = toContainsPattern(query);
  const matching = isRecipient
    ? sql` AND recipient.value LIKE ${like} ESCAPE '\\'`
    : sql` AND (m.from_address LIKE ${like} ESCAPE '\\' OR coalesce(m.from_name, '') LIKE ${like} ESCAPE '\\')`;
  const pattern = query.length === 0 ? sql`` : matching;
  const accounts = toAccountList(request.accountIds);
  const rows = database.all<SenderRow>(
    isRecipient
      ? toRecipientStatement(accounts, pattern, limit)
      : toSenderStatement(accounts, pattern, limit)
  );

  return {
    senders: rows.map(
      (row) =>
        ({
          address: row.address,
          messageCount: row.message_count,
          ...(row.name === null || row.name.length === 0
            ? {}
            : { name: row.name }),
        }) satisfies GmailSenderSuggestion
    ),
  };
};

export const searchIndexedThreads = Effect.fn("searchIndexedThreads")(
  function* searchIndexedThreads(request: GmailSearchRequest) {
    return yield* withDatabase("Could not search your email", (database) =>
      runIndexedThreadSearch(database, request)
    );
  }
);

export const listIndexedSenders = Effect.fn("listIndexedSenders")(
  function* listIndexedSenders(request: GmailSenderSuggestionRequest) {
    return yield* withDatabase("Could not load senders", (database) =>
      runSenderSuggestions(database, request)
    );
  }
);
