import { removeFilterDraft } from "@/mail/search-query";
import type {
  FilterDraft,
  SearchFilter,
  SearchQuery,
} from "@/mail/search-query";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import type { GmailThreadSummary } from "@/shared/ipc/mail";

import type { MailSearchCompletions } from "./mail-search-completions";

export const toMailSearchDraftFilter = (
  draft: FilterDraft | undefined
): SearchFilter | undefined =>
  draft === undefined || draft.value.trim().length === 0
    ? undefined
    : { field: draft.field, value: draft.value.trim() };

export const toLiveMailSearchQuery = (
  query: SearchQuery,
  draft: FilterDraft | undefined,
  draftFilter: SearchFilter | undefined
): SearchQuery =>
  draft === undefined
    ? query
    : {
        filters:
          draftFilter === undefined
            ? query.filters
            : [...query.filters, draftFilter],
        text: removeFilterDraft(query.text),
      };

export const getFirstMailSearchItem = (
  completions: MailSearchCompletions | undefined,
  threads: readonly GmailThreadSummary[]
): string => {
  const completion = completions?.items[0]?.value;
  if (completion !== undefined) {
    return completion;
  }
  const [thread] = threads;
  return thread === undefined ? "" : `thread:${getThreadSelectionKey(thread)}`;
};
