import { create } from "zustand";

import { createMailSearchQuery } from "@/mail/search-query";
import type { SearchQuery } from "@/mail/search-query";

interface MailSearchState {
  readonly isActive: boolean;
  readonly isDirty: boolean;
  readonly query: SearchQuery;
  readonly revision: number;
  readonly activate: () => void;
  readonly exit: () => void;
  readonly updateQuery: (query: SearchQuery) => void;
}

const INITIAL_QUERY = createMailSearchQuery();

export const useMailSearchStore = create<MailSearchState>()((set) => ({
  activate: () => {
    set((state) =>
      state.isActive
        ? state
        : {
            isActive: true,
            isDirty: false,
            query: createMailSearchQuery(),
            revision: state.revision + 1,
          }
    );
  },
  exit: () => {
    set((state) =>
      state.isActive
        ? {
            isActive: false,
            isDirty: false,
            revision: state.revision + 1,
          }
        : state
    );
  },
  isActive: false,
  isDirty: false,
  query: INITIAL_QUERY,
  revision: 0,
  updateQuery: (query) => {
    set((state) =>
      state.isActive
        ? {
            isDirty: true,
            query,
            revision: state.revision + 1,
          }
        : state
    );
  },
}));

export const useIsMailSearchActive = (): boolean =>
  useMailSearchStore((state) => state.isActive);
