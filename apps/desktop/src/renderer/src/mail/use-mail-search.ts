import { useEffect, useEffectEvent, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type {
  GmailAddressRole,
  GmailSenderSuggestion,
  GmailThreadListChange,
  GmailThreadSummary,
} from "@/shared/ipc/mail";

import { getThreadListChangeAccountId } from "./mailbox-model";
import { formatSearchQuery, isMailSearchQueryReady } from "./search-query";
import type { SearchQuery } from "./search-query";

/**
 * The index is local, so this only has to outrun the keyboard rather than the
 * network — a fraction of the 300 ms the Gmail-backed mailbox search uses.
 */
const SEARCH_DEBOUNCE_MS = 100;
/** The rows are virtualised, so the mailbox can hold a deep result set. */
const SEARCH_RESULT_LIMIT = 200;

/**
 * A mailbox has far more than a screenful of senders, and the list scrolls —
 * showing a handful makes an account look like it hears from almost nobody.
 */
const SENDER_SUGGESTION_LIMIT = 50;

export interface MailSearchState {
  hasMore: boolean;
  isLoading: boolean;
  threads: readonly GmailThreadSummary[];
}

interface LoadedResults {
  hasMore: boolean;
  /** The request these results answer; loading is `key !==` the live one. */
  key: string;
  threads: readonly GmailThreadSummary[];
}

const NO_RESULTS: LoadedResults = { hasMore: false, key: "", threads: [] };

const EMPTY_STATE: MailSearchState = {
  hasMore: false,
  isLoading: false,
  threads: [],
};

/**
 * Runs the inline mailbox query against the local mail index.
 *
 * An empty query is a query too: it answers with the newest mail, which is what
 * the result list shows for a broadened empty query. Results from the previous
 * keystroke stay on screen until the next ones land, so the list refines
 * instead of blinking empty between them.
 */
export const useMailSearch = (
  accountIds: readonly string[],
  query: SearchQuery,
  isEnabled: boolean
): MailSearchState => {
  const mailApi = getMailApi();
  const isReady = isEnabled && isMailSearchQueryReady(query);
  const [results, setResults] = useState<LoadedResults>(NO_RESULTS);
  const [revision, setRevision] = useState(0);
  const queryKey = formatSearchQuery(query);
  const requestKey = JSON.stringify([accountIds, queryKey]);

  const includesSelectedAccount = useEffectEvent(
    (changes: readonly GmailThreadListChange[]): boolean =>
      changes.some((change) =>
        accountIds.includes(getThreadListChangeAccountId(change))
      )
  );
  const searchMail = useEffectEvent(() =>
    mailApi?.search({
      accountIds,
      filters: query.filters,
      limit: SEARCH_RESULT_LIMIT,
      text: query.text,
    })
  );

  // Mail that arrives while inline search is active is mail the result list should
  // find. The index is written before this fires, so a refetch sees it.
  useEffect(() => {
    if (mailApi === undefined || !isReady) {
      return;
    }

    return mailApi.onThreadListUpdated(({ changes }) => {
      if (includesSelectedAccount(changes)) {
        setRevision((current) => current + 1);
      }
    });
  }, [isReady, mailApi]);

  useEffect(() => {
    if (mailApi === undefined || !isReady) {
      return;
    }

    let isActive = true;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const reply = await searchMail();

        if (!isActive || reply === undefined) {
          return;
        }

        setResults(
          reply.ok
            ? {
                hasMore: reply.data.hasMore,
                key: requestKey,
                threads: reply.data.threads,
              }
            : { ...NO_RESULTS, key: requestKey }
        );
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `revision` reruns the search when new mail for these accounts is indexed.
  }, [isReady, mailApi, requestKey, revision]);

  return isReady
    ? {
        hasMore: results.hasMore,
        isLoading: results.key !== requestKey,
        threads: results.threads,
      }
    : EMPTY_STATE;
};

interface LoadedSenders {
  key: string;
  senders: readonly GmailSenderSuggestion[];
}

const NO_SENDERS: LoadedSenders = { key: "", senders: [] };

/**
 * Addresses to complete a `from:` or `to:` pill with, drawn from the mail
 * already indexed rather than from a contacts API.
 */
export const useAddressSuggestions = (
  accountIds: readonly string[],
  role: GmailAddressRole | undefined,
  search: string | undefined
): readonly GmailSenderSuggestion[] => {
  const mailApi = getMailApi();
  const [loaded, setLoaded] = useState<LoadedSenders>(NO_SENDERS);
  const requestKey = JSON.stringify([accountIds, role ?? "", search ?? ""]);
  const listSenders = useEffectEvent(() =>
    role === undefined || search === undefined
      ? undefined
      : mailApi?.listSenders({
          accountIds,
          limit: SENDER_SUGGESTION_LIMIT,
          query: search,
          role,
        })
  );

  useEffect(() => {
    if (mailApi === undefined || role === undefined || search === undefined) {
      return;
    }

    let isActive = true;
    // Compose completion is already a bounded in-memory scan in main. Search
    // roles still hit SQLite and keep the keyboard debounce.
    const debounceMs = role === "correspondent" ? 0 : SEARCH_DEBOUNCE_MS;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const reply = await listSenders();

        if (isActive && reply !== undefined) {
          setLoaded({
            key: requestKey,
            senders: reply.ok ? reply.data.senders : [],
          });
        }
      })();
    }, debounceMs);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
  }, [mailApi, requestKey, role, search]);

  return role === undefined || search === undefined || loaded.key !== requestKey
    ? []
    : loaded.senders;
};
