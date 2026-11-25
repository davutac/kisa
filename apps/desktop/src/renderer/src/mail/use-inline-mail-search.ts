import { getMailboxPlaceKey } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import {
  applyExternalMailSearchScope,
  isMailSearchQueryReady,
  toLiveMailSearchQuery,
} from "@/mail/search-query";
import { useMailSearch } from "@/mail/use-mail-search";
import { useMailSearchStore } from "@/state/mail-search";

export const useInlineMailSearch = (
  accountIds: readonly string[],
  mailbox: MailboxPlace,
  unreadOnly: boolean
) => {
  const isActive = useMailSearchStore((state) => state.isActive);
  const queryDraft = useMailSearchStore((state) => state.query);
  const revision = useMailSearchStore((state) => state.revision);
  const query = toLiveMailSearchQuery(queryDraft);

  const effectiveQuery = applyExternalMailSearchScope(query, {
    mailbox,
    unreadOnly,
  });

  const results = useMailSearch(accountIds, effectiveQuery, isActive);

  return {
    isReady: isMailSearchQueryReady(query),
    isShowingResults: isActive,
    mailbox,
    resetKey: JSON.stringify([
      "search",
      revision,
      accountIds,
      getMailboxPlaceKey(mailbox),
      unreadOnly,
    ]),
    results,
    showAccount: accountIds.length > 1,
  };
};
