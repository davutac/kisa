import {
  applyExternalMailSearchScope,
  isMailSearchQueryReady,
  toLiveMailSearchQuery,
} from "@/mail/search-query";
import { useMailSearch } from "@/mail/use-mail-search";
import type { GmailMailbox } from "@/shared/ipc/mail";
import { useMailSearchStore } from "@/state/mail-search";

export const useInlineMailSearch = (
  accountIds: readonly string[],
  mailbox: GmailMailbox,
  unreadOnly: boolean,
  labelNames: readonly string[]
) => {
  const isActive = useMailSearchStore((state) => state.isActive);
  const isDirty = useMailSearchStore((state) => state.isDirty);
  const queryDraft = useMailSearchStore((state) => state.query);
  const revision = useMailSearchStore((state) => state.revision);
  const query = toLiveMailSearchQuery(queryDraft);
  const effectiveQuery = applyExternalMailSearchScope(query, {
    labelNames,
    mailbox,
    unreadOnly,
  });
  const results = useMailSearch(
    accountIds,
    effectiveQuery,
    isActive && isDirty
  );

  return {
    isReady: isMailSearchQueryReady(query),
    isShowingResults: isActive && isDirty,
    mailbox,
    resetKey: JSON.stringify([
      "search",
      revision,
      accountIds,
      labelNames,
      mailbox,
      unreadOnly,
    ]),
    results,
    showAccount: accountIds.length > 1,
  };
};
