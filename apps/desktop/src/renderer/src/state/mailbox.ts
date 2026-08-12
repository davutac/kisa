import { create } from "zustand";

import type { GmailMailbox } from "@/shared/ipc/mail";

interface MailboxState {
  /** Account-qualified thread keys checked for a mailbox bulk action. */
  checkedThreadIds: ReadonlySet<string>;
  /** The thread being read, over a mailbox that stays mounted underneath. */
  openThreadId: string | null;
  mailbox: GmailMailbox;
  /** `null` shows every account. */
  selectedAccountId: string | null;
  /** A thread selection key, see `getThreadSelectionKey`. */
  selectedThreadId: string | null;
  showUnread: boolean;
  checkThread: (threadId: string, checked: boolean) => void;
  clearCheckedThreads: () => void;
  closeThread: () => void;
  openThread: (threadId: string) => void;
  selectAccount: (accountId: string | null) => void;
  selectThread: (threadId: string | null) => void;
  retainCheckedThreads: (threadIds: ReadonlySet<string>) => void;
  setShowUnread: (showUnread: boolean) => void;
  setMailbox: (mailbox: GmailMailbox) => void;
}

// Narrowing the mailbox strands a selection that is no longer in the list, so
// every setter that changes the scope clears it and closes what it opened.
export const useMailboxStore = create<MailboxState>()((set) => ({
  checkThread: (threadId, checked) => {
    set((state) => {
      if (state.checkedThreadIds.has(threadId) === checked) {
        return state;
      }

      const next = new Set(state.checkedThreadIds);

      if (checked) {
        next.add(threadId);
      } else {
        next.delete(threadId);
      }

      return { checkedThreadIds: next };
    });
  },
  checkedThreadIds: new Set(),
  clearCheckedThreads: () => {
    set((state) =>
      state.checkedThreadIds.size === 0
        ? state
        : { checkedThreadIds: new Set() }
    );
  },
  closeThread: () => {
    set({ openThreadId: null });
  },
  mailbox: "inbox",
  openThread: (openThreadId) => {
    set({ openThreadId, selectedThreadId: openThreadId });
  },
  openThreadId: null,
  retainCheckedThreads: (threadIds) => {
    set((state) => {
      const checkedThreadIds = new Set(
        [...state.checkedThreadIds].filter((threadId) =>
          threadIds.has(threadId)
        )
      );

      return checkedThreadIds.size === state.checkedThreadIds.size
        ? state
        : { checkedThreadIds };
    });
  },
  selectAccount: (selectedAccountId) => {
    set({
      checkedThreadIds: new Set(),
      openThreadId: null,
      selectedAccountId,
      selectedThreadId: null,
    });
  },
  selectThread: (selectedThreadId) => {
    set((state) =>
      state.selectedThreadId === selectedThreadId ? state : { selectedThreadId }
    );
  },
  selectedAccountId: null,
  selectedThreadId: null,
  setMailbox: (mailbox) => {
    set({
      checkedThreadIds: new Set(),
      mailbox,
      openThreadId: null,
      selectedThreadId: null,
    });
  },
  setShowUnread: (showUnread) => {
    set({
      checkedThreadIds: new Set(),
      openThreadId: null,
      selectedThreadId: null,
      showUnread,
    });
  },
  showUnread: false,
}));

export const useOpenThreadId = (): string | null =>
  useMailboxStore((state) => state.openThreadId);

export const useCheckedThreadIds = (): ReadonlySet<string> =>
  useMailboxStore((state) => state.checkedThreadIds);

export const useMailbox = (): GmailMailbox =>
  useMailboxStore((state) => state.mailbox);

export const useSelectedAccountId = (): string | null =>
  useMailboxStore((state) => state.selectedAccountId);

export const useSelectedThreadId = (): string | null =>
  useMailboxStore((state) => state.selectedThreadId);

export const useShowUnread = (): boolean =>
  useMailboxStore((state) => state.showUnread);
