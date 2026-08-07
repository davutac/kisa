import { create } from "zustand";

interface MailboxState {
  /** The thread being read, over a mailbox that stays mounted underneath. */
  openThreadId: string | null;
  searchQuery: string;
  /** `null` shows every account. */
  selectedAccountId: string | null;
  /** A thread selection key, see `getThreadSelectionKey`. */
  selectedThreadId: string | null;
  showUnread: boolean;
  closeThread: () => void;
  openThread: (threadId: string) => void;
  selectAccount: (accountId: string | null) => void;
  selectThread: (threadId: string | null) => void;
  setSearchQuery: (searchQuery: string) => void;
  setShowUnread: (showUnread: boolean) => void;
}

// Narrowing the mailbox strands a selection that is no longer in the list, so
// every setter that changes the scope clears it and closes what it opened.
export const useMailboxStore = create<MailboxState>()((set) => ({
  closeThread: () => {
    set({ openThreadId: null });
  },
  openThread: (openThreadId) => {
    set({ openThreadId, selectedThreadId: openThreadId });
  },
  openThreadId: null,
  searchQuery: "",
  selectAccount: (selectedAccountId) => {
    set({ openThreadId: null, selectedAccountId, selectedThreadId: null });
  },
  selectThread: (selectedThreadId) => {
    set({ selectedThreadId });
  },
  selectedAccountId: null,
  selectedThreadId: null,
  setSearchQuery: (searchQuery) => {
    set({ openThreadId: null, searchQuery, selectedThreadId: null });
  },
  setShowUnread: (showUnread) => {
    set({ openThreadId: null, selectedThreadId: null, showUnread });
  },
  showUnread: false,
}));

export const useOpenThreadId = (): string | null =>
  useMailboxStore((state) => state.openThreadId);

export const useSearchQuery = (): string =>
  useMailboxStore((state) => state.searchQuery);

export const useSelectedAccountId = (): string | null =>
  useMailboxStore((state) => state.selectedAccountId);

export const useSelectedThreadId = (): string | null =>
  useMailboxStore((state) => state.selectedThreadId);

export const useShowUnread = (): boolean =>
  useMailboxStore((state) => state.showUnread);
