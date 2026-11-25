import { create } from "zustand";

import { createMailSearchQuery } from "@/mail/search-query";
import type { SearchQuery } from "@/mail/search-query";

/**
 * The search whose results fill the mailbox list. The search bar edits its own
 * draft and only touches this when the user asks to show every result.
 */
interface MailSearchState {
  /** Whether the mailbox list shows search results instead of the mailbox. */
  readonly isActive: boolean;
  readonly query: SearchQuery;
  /** Bumped on every new result set, so the list resets its scroll and selection. */
  readonly revision: number;
  readonly exit: () => void;
  readonly showResults: (query: SearchQuery) => void;
}

export const useMailSearchStore = create<MailSearchState>()((set) => ({
  exit: () => {
    set((state) =>
      state.isActive
        ? {
            isActive: false,
            query: createMailSearchQuery(),
            revision: state.revision + 1,
          }
        : state
    );
  },
  isActive: false,
  query: createMailSearchQuery(),
  revision: 0,
  showResults: (query) => {
    set((state) => ({
      isActive: true,
      query,
      revision: state.revision + 1,
    }));
  },
}));

export const useIsMailSearchActive = (): boolean =>
  useMailSearchStore((state) => state.isActive);
