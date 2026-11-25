import { create } from "zustand";

import { isSameMailboxPlace } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";
import {
  readUnreadFilter,
  writeUnreadFilter,
} from "@/state/unread-filter-preference";

interface MailboxState {
  /** Account-qualified thread keys checked for a mailbox bulk action. */
  checkedThreadIds: ReadonlySet<string>;
  /** The thread being read, over a mailbox that stays mounted underneath. */
  openThreadId: string | null;
  /** The system mailbox or user label the list shows. */
  mailbox: MailboxPlace;
  /** `null` shows every account. */
  selectedAccountId: string | null;
  /** A thread selection key, see `getThreadSelectionKey`. */
  selectedThreadId: string | null;
  /** Remembered across inbox switches and restarts; see `setShowUnread`. */
  showUnread: boolean;
  checkThread: (threadId: string, checked: boolean) => void;
  clearCheckedThreads: () => void;
  closeThread: () => void;
  openThread: (threadId: string) => void;
  selectAccount: (accountId: string | null) => void;
  /** Opens an account scope's Inbox, keeping the unread filter. */
  selectInbox: (accountId: string | null) => void;
  /** Moves to another account scope and mailbox in one step, keeping the unread filter. */
  selectMailbox: (accountId: string | null, mailbox: MailboxPlace) => void;
  selectThread: (threadId: string | null) => void;
  setCheckedThreads: (threadIds: ReadonlySet<string>) => void;
  setMailbox: (mailbox: MailboxPlace) => void;
  setShowUnread: (showUnread: boolean) => void;
}

// A label place arrives as a new object each time it is chosen; keeping the
// one already shown leaves effects keyed on it alone.
const keepEqualPlace = (
  current: MailboxPlace,
  next: MailboxPlace
): MailboxPlace => (isSameMailboxPlace(current, next) ? current : next);

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
    });
  },
  selectMailbox: (selectedAccountId, mailbox) => {
    set((state) => ({
      checkedThreadIds: new Set(),
      mailbox: keepEqualPlace(state.mailbox, mailbox),
      openThreadId: null,
      selectedAccountId,
      selectedThreadId: null,
    }));
  },
  selectThread: (selectedThreadId) => {
    set((state) =>
      state.selectedThreadId === selectedThreadId ? state : { selectedThreadId }
    );
  },
  selectedAccountId: null,
  selectedThreadId: null,
  setCheckedThreads: (threadIds) => {
    set((state) =>
      threadIds.size === state.checkedThreadIds.size &&
      [...threadIds].every((threadId) => state.checkedThreadIds.has(threadId))
        ? state
        : { checkedThreadIds: threadIds }
    );
  },
  setMailbox: (mailbox) => {
    set((state) => ({
      checkedThreadIds: new Set(),
      mailbox: keepEqualPlace(state.mailbox, mailbox),
      openThreadId: null,
      selectedThreadId: null,
    }));
  },
  setShowUnread: (showUnread) => {
    writeUnreadFilter(showUnread);
    set({
      checkedThreadIds: new Set(),
      openThreadId: null,
      selectedThreadId: null,
      showUnread,
    });
  },
  showUnread: readUnreadFilter(),
}));

export const useOpenThreadId = (): string | null =>
  useMailboxStore((state) => state.openThreadId);

export const useCheckedThreadIds = (): ReadonlySet<string> =>
  useMailboxStore((state) => state.checkedThreadIds);

export const useMailbox = (): MailboxPlace =>
  useMailboxStore((state) => state.mailbox);

export const useSelectedAccountId = (): string | null =>
  useMailboxStore((state) => state.selectedAccountId);

export const useSelectedThreadId = (): string | null =>
  useMailboxStore((state) => state.selectedThreadId);

export const useShowUnread = (): boolean =>
  useMailboxStore((state) => state.showUnread);
