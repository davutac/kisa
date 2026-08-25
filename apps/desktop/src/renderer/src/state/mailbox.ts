import { create } from "zustand";

import { normalizeMailboxLabelSelection } from "@/mail/mailbox-labels";
import type { GmailMailbox } from "@/shared/ipc/mail";

interface MailboxState {
  /** Account-qualified thread keys checked for a mailbox bulk action. */
  checkedThreadIds: ReadonlySet<string>;
  /** The thread being read, over a mailbox that stays mounted underneath. */
  openThreadId: string | null;
  mailbox: GmailMailbox;
  /** `null` shows every account. */
  selectedAccountId: string | null;
  /** Case-normalized user label names used as a match-all mailbox filter. */
  selectedLabelNames: readonly string[];
  /** A thread selection key, see `getThreadSelectionKey`. */
  selectedThreadId: string | null;
  showUnread: boolean;
  checkThread: (threadId: string, checked: boolean) => void;
  clearCheckedThreads: () => void;
  closeThread: () => void;
  openThread: (threadId: string) => void;
  selectAccount: (accountId: string | null) => void;
  selectInbox: (accountId: string | null) => void;
  selectThread: (threadId: string | null) => void;
  retainCheckedThreads: (threadIds: ReadonlySet<string>) => void;
  retainSelectedLabels: (availableNames: ReadonlySet<string>) => void;
  setMailbox: (mailbox: GmailMailbox) => void;
  setSelectedLabels: (labelNames: readonly string[]) => void;
  setShowUnread: (showUnread: boolean) => void;
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
  retainSelectedLabels: (availableNames) => {
    set((state) => {
      const selectedLabelNames = state.selectedLabelNames.filter((name) =>
        availableNames.has(name)
      );

      return selectedLabelNames.length === state.selectedLabelNames.length
        ? state
        : {
            checkedThreadIds: new Set(),
            openThreadId: null,
            selectedLabelNames,
            selectedThreadId: null,
          };
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
  selectInbox: (selectedAccountId) => {
    set({
      checkedThreadIds: new Set(),
      mailbox: "inbox",
      openThreadId: null,
      selectedAccountId,
      selectedThreadId: null,
      showUnread: false,
    });
  },
  selectThread: (selectedThreadId) => {
    set((state) =>
      state.selectedThreadId === selectedThreadId ? state : { selectedThreadId }
    );
  },
  selectedAccountId: null,
  selectedLabelNames: [],
  selectedThreadId: null,
  setMailbox: (mailbox) => {
    set({
      checkedThreadIds: new Set(),
      mailbox,
      openThreadId: null,
      selectedThreadId: null,
    });
  },
  setSelectedLabels: (labelNames) => {
    const selectedLabelNames = normalizeMailboxLabelSelection(labelNames);

    set((state) =>
      selectedLabelNames.length === state.selectedLabelNames.length &&
      selectedLabelNames.every(
        (name, index) => name === state.selectedLabelNames[index]
      )
        ? state
        : {
            checkedThreadIds: new Set(),
            openThreadId: null,
            selectedLabelNames,
            selectedThreadId: null,
          }
    );
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

export const useSelectedLabelNames = (): readonly string[] =>
  useMailboxStore((state) => state.selectedLabelNames);

export const useSelectedThreadId = (): string | null =>
  useMailboxStore((state) => state.selectedThreadId);

export const useShowUnread = (): boolean =>
  useMailboxStore((state) => state.showUnread);
