import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import type { GmailMessage } from "@repo/gmail/models";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type {
  GmailSenderSuggestion,
  GmailSenderSuggestions,
} from "../../shared/ipc/mail";

/**
 * Enough history for useful completion without allowing a bulk-mail mailbox to
 * turn the main process into an unbounded address book.
 */
const MAX_CORRESPONDENTS_PER_ACCOUNT = 10_000;

type CorrespondentMessage = Pick<GmailMessage, "bcc" | "cc" | "from" | "to">;

type CorrespondentTuple = [
  accountId: string,
  address: string,
  name: string | null,
  messageCount: number,
];

const correspondentsByAccount = new Map<
  string,
  Map<string, GmailSenderSuggestion>
>();

const toAccountList = (accountIds: readonly string[]): SQL =>
  sql.join(
    accountIds.map((accountId) => sql`${accountId}`),
    sql`, `
  );

const toCacheKey = (address: string): string => address.trim().toLowerCase();

const compareSuggestions = (
  left: GmailSenderSuggestion,
  right: GmailSenderSuggestion
): number =>
  right.messageCount - left.messageCount ||
  left.address.localeCompare(right.address);

const loadAccountSnapshots = async (
  database: RemoteDatabaseClient,
  accountIds: readonly string[]
): Promise<void> => {
  const accounts = toAccountList(accountIds);
  const tuples = await database.values<CorrespondentTuple>(sql`
    WITH correspondent_addresses AS (
      SELECT m.account_email, m.from_address AS address,
             coalesce(m.from_name, '') AS name
      FROM gmail_messages m
      WHERE m.account_email IN (${accounts})

      UNION ALL

      SELECT m.account_email, recipient.value AS address, '' AS name
      FROM gmail_messages m
      JOIN json_each(coalesce(m.to_addresses, '[]')) AS recipient
      WHERE m.account_email IN (${accounts})

      UNION ALL

      SELECT m.account_email, recipient.value AS address, '' AS name
      FROM gmail_messages m
      JOIN json_each(coalesce(m.cc_addresses, '[]')) AS recipient
      WHERE m.account_email IN (${accounts})

      UNION ALL

      SELECT m.account_email, recipient.value AS address, '' AS name
      FROM gmail_messages m
      JOIN json_each(coalesce(m.bcc_addresses, '[]')) AS recipient
      WHERE m.account_email IN (${accounts})
    ), grouped AS (
      SELECT account_email, address, max(name) AS name,
             count(*) AS message_count
      FROM correspondent_addresses
      WHERE typeof(address) = 'text' AND length(trim(address)) > 0
      GROUP BY account_email, lower(address)
    ), ranked AS (
      SELECT account_email, address, name, message_count,
             row_number() OVER (
               PARTITION BY account_email
               ORDER BY message_count DESC, address ASC
             ) AS address_rank
      FROM grouped
    )
    SELECT account_email, address, name, message_count
    FROM ranked
    WHERE address_rank <= ${MAX_CORRESPONDENTS_PER_ACCOUNT}
    ORDER BY account_email ASC, address_rank ASC
  `);
  const nextByAccount = new Map(
    accountIds.map(
      (accountId) =>
        [accountId, new Map<string, GmailSenderSuggestion>()] as const
    )
  );

  for (const [accountId, address, name, messageCount] of tuples) {
    nextByAccount.get(accountId)?.set(toCacheKey(address), {
      address,
      messageCount,
      ...(name === null || name.length === 0 ? {} : { name }),
    });
  }

  for (const [accountId, correspondents] of nextByAccount) {
    correspondentsByAccount.set(accountId, correspondents);
  }
};

/**
 * Builds every missing account snapshot in one utility-process query. The
 * window function applies the memory ceiling independently per account.
 */
export const loadCachedCorrespondentsRemote = async (
  database: RemoteDatabaseClient,
  accountIds: readonly string[]
): Promise<void> => {
  const missingAccountIds = [...new Set(accountIds)].filter(
    (accountId) => !correspondentsByAccount.has(accountId)
  );

  if (missingAccountIds.length === 0) {
    return;
  }

  await loadAccountSnapshots(database, missingAccountIds);
};

/**
 * Returns `undefined` only when an account has not been warmed yet. An empty
 * map is a valid, loaded cache for a new mailbox.
 */
export const listCachedCorrespondents = (
  accountIds: readonly string[],
  query: string | undefined,
  limit: number
): GmailSenderSuggestions | undefined => {
  if (accountIds.length === 0) {
    return { senders: [] };
  }

  const needle = query?.trim().toLowerCase() ?? "";
  const merged = new Map<string, GmailSenderSuggestion>();

  for (const accountId of new Set(accountIds)) {
    const account = correspondentsByAccount.get(accountId);

    if (account === undefined) {
      return;
    }

    for (const [key, suggestion] of account) {
      if (needle.length > 0 && !key.includes(needle)) {
        continue;
      }

      const existing = merged.get(key);

      if (existing === undefined) {
        merged.set(key, suggestion);
        continue;
      }

      const name = existing.name ?? suggestion.name;

      merged.set(key, {
        address: existing.address,
        messageCount: existing.messageCount + suggestion.messageCount,
        ...(name === undefined ? {} : { name }),
      });
    }
  }

  return {
    senders: [...merged.values()].toSorted(compareSuggestions).slice(0, limit),
  };
};

/**
 * Mail already arrives in main as parsed domain data. Fold newly observed
 * addresses into an existing snapshot after its database transaction commits,
 * so normal sync and backfill keep completion fresh without another scan.
 */
export const rememberCorrespondentMessages = (
  accountId: string,
  messages: readonly CorrespondentMessage[]
): void => {
  const cached = correspondentsByAccount.get(accountId);

  // A later warm reads the authoritative database, including these messages.
  if (cached === undefined) {
    return;
  }

  const rememberMailbox = (mailbox: GmailMessage["from"]): void => {
    const key = toCacheKey(mailbox.address);

    if (key.length === 0) {
      return;
    }

    const existing = cached.get(key);

    if (existing !== undefined) {
      if (existing.name === undefined && mailbox.name !== undefined) {
        cached.set(key, { ...existing, name: mailbox.name });
      }
      return;
    }

    cached.set(key, {
      address: mailbox.address,
      messageCount: 1,
      ...(mailbox.name === undefined ? {} : { name: mailbox.name }),
    });
  };

  for (const message of messages) {
    rememberMailbox(message.from);

    for (const mailbox of [...message.to, ...message.cc, ...message.bcc]) {
      rememberMailbox(mailbox);
    }
  }

  if (cached.size > MAX_CORRESPONDENTS_PER_ACCOUNT) {
    correspondentsByAccount.set(
      accountId,
      new Map(
        [...cached.entries()]
          .toSorted((left, right) => compareSuggestions(left[1], right[1]))
          .slice(0, MAX_CORRESPONDENTS_PER_ACCOUNT)
      )
    );
  }
};

export const forgetCachedCorrespondents = (accountId?: string): void => {
  if (accountId === undefined) {
    correspondentsByAccount.clear();
  } else {
    correspondentsByAccount.delete(accountId);
  }
};
