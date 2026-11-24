import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailThreads } from "@repo/database/schemas";
import type { SQL } from "drizzle-orm";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import type {
  MailSearchFilter,
  MailSearchRequest,
  MailSearchResults,
  MailSenderSuggestion,
  MailSenderSuggestionRequest,
  MailSenderSuggestions,
} from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import {
  listCachedCorrespondents,
  loadCachedCorrespondentsRemote,
} from "./correspondent-cache";
import { toThreadSummary } from "./engine/mail-reads";
import { toContainsPattern, toFtsMatchQuery } from "./search-match";

const DEFAULT_RESULT_LIMIT = 50;
const MAX_RESULT_LIMIT = 200;
const DEFAULT_SENDER_LIMIT = 8;
const MAX_SENDER_LIMIT = 50;

/**
 * A prefix query typed one letter at a time ("i", "in", "inv") matches a large
 * share of a full mailbox on its way to being specific, and inline search only
 * shows the newest handful. Bounding the message scan keeps the broad
 * intermediate queries cheap; the cap takes the newest matches, which is the
 * order results are shown in anyway.
 */
const MAX_MATCHED_MESSAGES = 5000;

// oxlint-disable-next-line unicorn/throw-new-error
class MailSearchError extends Schema.TaggedError<
  MailSearchError,
  { readonly brand: unique symbol }
>()("MailSearchError", { message: Schema.String }) {}

const withDatabase = <A>(
  message: string,
  run: (database: RemoteDatabaseClient) => Promise<A>
) =>
  withDatabaseClient(run).pipe(
    Effect.mapError(() => new MailSearchError({ message }))
  );

interface SenderRow {
  readonly address: string;
  readonly message_count: number;
  readonly name: string | null;
}

/** The search statement returns only ids, in result order. */
type SearchThreadTuple = [accountId: string, threadId: string];

type SenderTuple = [address: string, name: string | null, messageCount: number];

const toSenderRow = (row: SenderTuple): SenderRow => ({
  address: row[0],
  message_count: row[2],
  name: row[1],
});

const clampLimit = (limit: number | undefined, fallback: number, max: number) =>
  limit === undefined ? fallback : Math.min(Math.max(1, limit), max);

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
  filters: readonly MailSearchFilter[]
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
  filters: readonly MailSearchFilter[]
): readonly SQL[] =>
  filters.flatMap((filter) => {
    if (filter.field === "is") {
      const value = filter.value.toLowerCase();

      if (value === "unread") {
        return [sql`t.is_unread = 1`];
      }

      return value === "read" ? [sql`t.is_unread = 0`] : [];
    }

    if (filter.field === "label") {
      const value = filter.value.toLowerCase();

      if (value === "inbox") {
        return [sql`t.is_in_inbox = 1`];
      }

      if (value === "spam") {
        return [sql`t.is_in_spam = 1`];
      }

      if (value === "trash") {
        return [sql`t.is_in_trash = 1`];
      }

      if (value === "sent") {
        return [
          sql`t.is_in_sent = 1`,
          sql`t.is_in_spam = 0`,
          sql`t.is_in_trash = 0`,
        ];
      }

      return [
        sql`EXISTS (
          SELECT 1
          FROM json_each(t.label_ids) AS thread_label
          WHERE lower(thread_label.value) IN (
            lower(${filter.value}),
            lower('u:' || ${filter.value})
          )
        )`,
      ];
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
 * Column weights for `bm25`, in the order `mail_messages_fts` declares them.
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
const BM25_SCORE = sql`bm25(mail_messages_fts, ${sql.raw(String(SUBJECT_WEIGHT))}, ${sql.raw(String(SENDER_WEIGHT))}, ${sql.raw(String(BODY_WEIGHT))})`;

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
          order: sql`m.received_at DESC`,
          score: sql`0`,
          source: sql`FROM mail_messages m WHERE m.account_id IN (${accounts})`,
        }
      : {
          order: sql`score ASC`,
          score: BM25_SCORE,
          source: sql`FROM mail_messages_fts
            JOIN mail_messages m ON m.rowid = mail_messages_fts.rowid
            WHERE mail_messages_fts MATCH ${matchQuery}
              AND m.account_id IN (${accounts})`,
        };

  return {
    isRanked: matchQuery !== undefined,
    sql: sql`WITH matched AS MATERIALIZED (
      SELECT account_id, thread_id, min(score) AS score FROM (
        SELECT m.account_id AS account_id,
               m.thread_id AS thread_id,
               ${scored.score} AS score
        ${scored.source}${andAll(messageConditions)}
        ORDER BY ${scored.order}
        LIMIT ${MAX_MATCHED_MESSAGES}
      )
      GROUP BY account_id, thread_id
    )`,
  };
};

/**
 * Searches the local mail index rather than the server: results are instant,
 * work offline, and cover everything the background index has walked, which
 * is the whole account, not just the inbox.
 *
 * Takes the client rather than reaching for it, so the statement can be run
 * against a real migrated database in tests.
 */
const toThreadSearchQuery = (
  request: MailSearchRequest
): { readonly limit: number; readonly statement: SQL } | undefined => {
  const limit = clampLimit(
    request.limit,
    DEFAULT_RESULT_LIMIT,
    MAX_RESULT_LIMIT
  );

  if (request.accountIds.length === 0) {
    return;
  }

  const filters = request.filters ?? [];
  const explicitlySearchesSpam = filters.some(
    (filter) =>
      filter.field === "label" && filter.value.toLowerCase() === "spam"
  );
  const accounts = toAccountList(request.accountIds);
  const matchQuery = toFtsMatchQuery(request.text ?? "");
  const messageConditions = toMessageConditions(filters);
  const needsMatchedMessages =
    matchQuery !== undefined || messageConditions.length > 0;
  const messageScopeConditions =
    explicitlySearchesSpam || !needsMatchedMessages
      ? []
      : [
          sql`EXISTS (
          SELECT 1
          FROM mail_threads message_thread
          WHERE message_thread.account_id = m.account_id
            AND message_thread.thread_id = m.thread_id
            AND message_thread.is_in_spam = 0
        )`,
        ];
  const matched = toMatchedThreadsCte(accounts, matchQuery, [
    ...messageScopeConditions,
    ...messageConditions,
  ]);
  // Words are a question about relevance, answered by rank against a mild age
  // penalty; filters alone are a question about a mailbox, answered by date.
  const order =
    matched?.isRanked === true
      ? sql`matched.score + ${RECENCY_PENALTY} * (1.0 - 1.0 / (1.0 + max(0, ${Date.now()} - t.latest_at) * 1.0 / ${RECENCY_SPAN_MS})) ASC, t.latest_at DESC`
      : sql`t.latest_at DESC`;
  return {
    limit,
    statement: sql`
      ${matched?.sql ?? sql``}
      SELECT t.account_id, t.thread_id
      ${
        // From the matched threads to their rows: left to choose, SQLite
        // reads every thread in the mailbox and looks each up in the matches.
        matched === undefined
          ? sql`FROM mail_threads t`
          : sql`FROM matched CROSS JOIN mail_threads t
                ON matched.account_id = t.account_id
                AND matched.thread_id = t.thread_id`
      }
      WHERE t.account_id IN (${accounts})${andAll([
        ...(explicitlySearchesSpam ? [] : [sql`t.is_in_spam = 0`]),
        ...toThreadConditions(filters),
      ])}
      ORDER BY ${order}, t.account_id ASC, t.thread_id ASC
      LIMIT ${limit + 1}
    `,
  };
};

/** Loads the matched threads' rows and keeps the search's order. */
const loadMatchedThreads = async (
  database: RemoteDatabaseClient,
  matches: readonly SearchThreadTuple[]
) => {
  const byAccount = new Map<string, string[]>();
  for (const [accountId, threadId] of matches) {
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), threadId]);
  }

  const rowGroups = await Promise.all(
    [...byAccount].map(([accountId, threadIds]) =>
      database
        .select()
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.accountId, accountId),
            inArray(mailThreads.threadId, threadIds)
          )
        )
        .all()
    )
  );
  const rows = rowGroups.flat();
  const rowsByKey = new Map(
    rows.map((row) => [`${row.accountId}\u0000${row.threadId}`, row])
  );

  return matches.flatMap(([accountId, threadId]) => {
    const row = rowsByKey.get(`${accountId}\u0000${threadId}`);
    return row === undefined ? [] : [toThreadSummary(row)];
  });
};

export const runIndexedThreadSearchRemote = async (
  database: RemoteDatabaseClient,
  request: MailSearchRequest
): Promise<MailSearchResults> => {
  const query = toThreadSearchQuery(request);

  if (query === undefined) {
    return { hasMore: false, threads: [] };
  }

  const matches = await database.values<SearchThreadTuple>(query.statement);

  return {
    hasMore: matches.length > query.limit,
    threads: await loadMatchedThreads(database, matches.slice(0, query.limit)),
  };
};

/**
 * Recipients come from this account's *sent* mail only. `to_addresses` is a
 * JSON array with no index of its own, so the scan has to be narrowed by
 * something that does have one: `(account_id, from_address)` picks out the
 * messages this account wrote, which is a small slice of a mailbox — and it is
 * exactly the set `to:` is asking about.
 */
const toRecipientStatement = (
  accounts: SQL,
  pattern: SQL,
  limit: number
): SQL => sql`
  SELECT recipient.value AS address, '' AS name, count(*) AS message_count
  FROM mail_messages m
  JOIN json_each(m.to_addresses) AS recipient
  WHERE m.account_id IN (${accounts})
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
    FROM mail_messages m
    WHERE m.account_id IN (${accounts})${pattern}
    GROUP BY lower(m.from_address)
    ORDER BY message_count DESC, address ASC
    LIMIT ${limit}
  `;

const toSenderSuggestionQuery = (
  request: MailSenderSuggestionRequest
): SQL | undefined => {
  const limit = clampLimit(
    request.limit,
    DEFAULT_SENDER_LIMIT,
    MAX_SENDER_LIMIT
  );
  const query = request.query?.trim() ?? "";

  if (request.accountIds.length === 0 || request.role === "correspondent") {
    return;
  }

  const like = toContainsPattern(query);
  const accounts = toAccountList(request.accountIds);
  let statement: SQL;

  if (request.role === "recipient") {
    const pattern =
      query.length === 0
        ? sql``
        : sql` AND recipient.value LIKE ${like} ESCAPE '\\'`;

    statement = toRecipientStatement(accounts, pattern, limit);
  } else {
    const pattern =
      query.length === 0
        ? sql``
        : sql` AND (m.from_address LIKE ${like} ESCAPE '\\' OR coalesce(m.from_name, '') LIKE ${like} ESCAPE '\\')`;

    statement = toSenderStatement(accounts, pattern, limit);
  }

  return statement;
};

const toSenderSuggestions = (
  rows: readonly SenderRow[]
): MailSenderSuggestions => ({
  senders: rows.map(
    (row) =>
      ({
        address: row.address,
        messageCount: row.message_count,
        name: row.name === null || row.name.length === 0 ? undefined : row.name,
      }) satisfies MailSenderSuggestion
  ),
});

const runSenderSuggestionsRemote = async (
  database: RemoteDatabaseClient,
  request: MailSenderSuggestionRequest
): Promise<MailSenderSuggestions> => {
  const query = toSenderSuggestionQuery(request);

  if (query === undefined) {
    return { senders: [] };
  }

  const tuples = await database.values<SenderTuple>(query);
  const rows = tuples.map(toSenderRow);

  return toSenderSuggestions(rows);
};

export const searchIndexedThreads = Effect.fn("searchIndexedThreads")(
  function* searchIndexedThreads(request: MailSearchRequest) {
    return yield* withDatabase("Could not search your email", (database) =>
      runIndexedThreadSearchRemote(database, request)
    );
  }
);

export const listIndexedSenders = Effect.fn("listIndexedSenders")(
  function* listIndexedSenders(request: MailSenderSuggestionRequest) {
    if (request.role === "correspondent") {
      const limit = clampLimit(
        request.limit,
        DEFAULT_SENDER_LIMIT,
        MAX_SENDER_LIMIT
      );
      const readCache = () =>
        listCachedCorrespondents(request.accountIds, request.query, limit);
      const cached = readCache();

      if (cached !== undefined) {
        return cached;
      }

      yield* withDatabase("Could not load correspondents", (database) =>
        loadCachedCorrespondentsRemote(database, request.accountIds)
      );

      return readCache() ?? { senders: [] };
    }

    return yield* withDatabase("Could not load senders", (database) =>
      runSenderSuggestionsRemote(database, request)
    );
  }
);

/** Warm compose completion without delaying the first window. */
export const warmCorrespondentCache = Effect.fn("warmCorrespondentCache")(
  function* warmCorrespondentCache() {
    yield* withDatabase(
      "Could not warm correspondent suggestions",
      async (database) => {
        const accounts = await database.query.mailAccounts.findMany({
          columns: { accountId: true },
        });

        await loadCachedCorrespondentsRemote(
          database,
          accounts.map(({ accountId }) => accountId)
        );
      }
    );
  }
);
