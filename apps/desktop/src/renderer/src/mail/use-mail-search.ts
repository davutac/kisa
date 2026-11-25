import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type {
  MailAddressRole,
  MailSearchResultsReply,
  MailSenderSuggestion,
  MailThreadListChange,
  MailThreadSummary,
} from "@/shared/ipc/mail";

import {
  getThreadListChangeAccountId,
  updateListedThreads,
} from "./mailbox-model";
import {
  projectThreadSummaries,
  usePendingThreadChanges,
} from "./pending-thread-changes";
import { formatSearchQuery, isMailSearchQueryReady } from "./search-query";
import type { SearchQuery } from "./search-query";

/**
 * The index is local, so this only has to outrun the keyboard rather than the
 * network.
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
  /** Why the search failed; a failed search is not one with no matches. */
  error?: string;
  hasMore: boolean;
  isLoading: boolean;
  /** Runs the same search again. */
  retry: () => void;
  threads: readonly MailThreadSummary[];
}

interface LoadedResults {
  error?: string;
  hasMore: boolean;
  /** The request these results answer; loading is `key !==` the live one. */
  key: string;
  threads: readonly MailThreadSummary[];
}

const NO_RESULTS: LoadedResults = { hasMore: false, key: "", threads: [] };

/** A search that has not run has nothing to try again. */
const NOTHING_TO_RETRY = (): void => undefined;

const EMPTY_STATE: MailSearchState = {
  hasMore: false,
  isLoading: false,
  retry: NOTHING_TO_RETRY,
  threads: [],
};

/**
 * What one search request answered. `undefined` is a request that never
 * answered at all, such as a rejected bridge call.
 */
export const toLoadedSearchResults = (
  key: string,
  reply: MailSearchResultsReply | undefined
): LoadedResults => {
  if (reply === undefined) {
    return { ...NO_RESULTS, error: "Could not search your mail", key };
  }
  return reply.ok
    ? { hasMore: reply.data.hasMore, key, threads: reply.data.threads }
    : { ...NO_RESULTS, error: reply.error, key };
};

/**
 * Runs a mail query against the local mail index: the search bar's top
 * matches, or every result once the mailbox list shows them.
 *
 * An empty query is a query too: it answers with the newest mail, which is what
 * the result list shows for a broadened empty query. Results from the previous
 * keystroke stay on screen until the next ones land, so the list refines
 * instead of blinking empty between them.
 */
export const useMailSearch = (
  accountIds: readonly string[],
  query: SearchQuery,
  isEnabled: boolean,
  limit = SEARCH_RESULT_LIMIT
): MailSearchState => {
  const mailApi = getMailApi();
  const pendingChanges = usePendingThreadChanges();
  const isReady = isEnabled && isMailSearchQueryReady(query);
  const [results, setResults] = useState<LoadedResults>(NO_RESULTS);
  const [revision, setRevision] = useState(0);
  const queryKey = formatSearchQuery(query);
  const requestKey = JSON.stringify([accountIds, queryKey, limit]);

  const includesSelectedAccount = useEffectEvent(
    (changes: readonly MailThreadListChange[]): boolean =>
      changes.some((change) =>
        accountIds.includes(getThreadListChangeAccountId(change))
      )
  );
  const searchMail = useEffectEvent(() =>
    mailApi?.search({
      accountIds,
      filters: query.filters,
      limit,
      text: query.text,
    })
  );

  // Mail that arrives while a search is running is mail its results should
  // find. The index is written before this fires, so a refetch sees it. The
  // rows already shown take the change at once, so a finished action does not
  // flash back to its old state while the search runs again.
  useEffect(() => {
    if (mailApi === undefined || !isReady) {
      return;
    }

    return mailApi.onThreadListUpdated(({ changes }) => {
      if (includesSelectedAccount(changes)) {
        setResults((current) => {
          const threads = updateListedThreads(current.threads, changes);
          return threads === current.threads
            ? current
            : { ...current, threads };
        });
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
        let reply: MailSearchResultsReply | undefined;
        try {
          reply = await searchMail();
        } catch {
          reply = undefined;
        }

        if (isActive) {
          setResults(toLoadedSearchResults(requestKey, reply));
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `revision` reruns the search when new mail for these accounts is indexed.
  }, [isReady, mailApi, requestKey, revision]);

  const retry = useCallback((): void => {
    setResults(NO_RESULTS);
    setRevision((current) => current + 1);
  }, []);

  return isReady
    ? {
        error: results.key === requestKey ? results.error : undefined,
        hasMore: results.hasMore,
        isLoading: results.key !== requestKey,
        retry,
        threads: projectThreadSummaries(results.threads, pendingChanges),
      }
    : EMPTY_STATE;
};

interface LoadedSenders {
  key: string;
  scope: string;
  senders: readonly MailSenderSuggestion[];
}

const NO_SENDERS: LoadedSenders = { key: "", scope: "", senders: [] };

/**
 * Addresses to complete a `from:` or `to:` pill with, drawn from the mail
 * already indexed rather than from a contacts API.
 *
 * `whileLoading: "previous"` keeps the last answer for the same accounts and
 * role until the next one arrives, for a caller that narrows it to the new
 * search itself; otherwise nothing shows while a search loads.
 */
export const useAddressSuggestions = (
  accountIds: readonly string[],
  role: MailAddressRole | undefined,
  search: string | undefined,
  { whileLoading = "empty" }: { whileLoading?: "empty" | "previous" } = {}
): readonly MailSenderSuggestion[] => {
  const mailApi = getMailApi();
  const [loaded, setLoaded] = useState<LoadedSenders>(NO_SENDERS);
  const scope = JSON.stringify([accountIds, role ?? ""]);
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
            scope,
            senders: reply.ok ? reply.data.senders : [],
          });
        }
      })();
    }, debounceMs);

    return () => {
      isActive = false;
      window.clearTimeout(timeout);
    };
  }, [mailApi, requestKey, role, scope, search]);

  if (role === undefined || search === undefined) {
    return [];
  }
  if (loaded.key === requestKey) {
    return loaded.senders;
  }
  return whileLoading === "previous" && loaded.scope === scope
    ? loaded.senders
    : [];
};
