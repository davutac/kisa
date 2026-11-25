import { useLocation, useNavigate } from "@tanstack/react-router";

import { retainMailboxThreadsSnapshotsForAccounts } from "@/mail/mailbox-cache";
import type { MailboxPlace } from "@/mail/mailbox-place";
import { requestMailboxReload } from "@/mail/mailbox-reload";
import { useAccounts } from "@/state/accounts";
import { useIsMailSearchActive } from "@/state/mail-search";
import { useMailboxStore } from "@/state/mailbox";

export interface MailboxNavigation {
  /** Shows one account's inbox, reloading it when already shown. */
  openAccount: (accountEmail: string) => void;
  /** Shows the combined inbox, reloading it when already shown. */
  openAllAccounts: () => void;
  /** Shows one mailbox or label for an account, or every account with `null`. */
  openMailbox: (accountId: string | null, mailbox: MailboxPlace) => void;
}

/**
 * Account-scope navigation, shared by the sidebar's rows and their hotkeys
 * so both routes through it behave identically.
 */
export const useMailboxNavigation = (): MailboxNavigation => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const accounts = useAccounts();
  const mailbox = useMailboxStore((state) => state.mailbox);
  const openThreadId = useMailboxStore((state) => state.openThreadId);
  const selectedAccountId = useMailboxStore((state) => state.selectedAccountId);
  const closeThread = useMailboxStore((state) => state.closeThread);
  const selectAccount = useMailboxStore((state) => state.selectAccount);
  const selectInbox = useMailboxStore((state) => state.selectInbox);
  const selectMailbox = useMailboxStore((state) => state.selectMailbox);
  const isMailSearchActive = useIsMailSearchActive();
  const isMailboxRoute = pathname === "/";

  const showMailbox = (): void => {
    if (!isMailboxRoute) {
      void navigate({ to: "/" });
    }
  };

  const retainScope = (accountId: string | null): void => {
    retainMailboxThreadsSnapshotsForAccounts(
      accountId === null ? accounts.map(({ email }) => email) : [accountId]
    );
  };

  const isShowingInbox = (accountId: string | null): boolean =>
    isMailboxRoute &&
    selectedAccountId === accountId &&
    mailbox === "inbox" &&
    openThreadId === null;

  // Opening the Inbox a conversation is open over goes back to it, as Escape
  // does: the list keeps its filter, selection, and scroll.
  const isReadingOverInbox = (accountId: string | null): boolean =>
    isMailboxRoute &&
    selectedAccountId === accountId &&
    mailbox === "inbox" &&
    openThreadId !== null;

  const selectAccountScope = (accountId: string | null): void => {
    if (isMailSearchActive) {
      selectAccount(accountId);

      return;
    }

    selectInbox(accountId);
  };

  return {
    openAccount: (accountEmail) => {
      if (isReadingOverInbox(accountEmail)) {
        closeThread();

        return;
      }

      if (!isMailSearchActive && isShowingInbox(accountEmail)) {
        requestMailboxReload();

        return;
      }

      retainScope(accountEmail);
      selectAccountScope(accountEmail);
      showMailbox();
    },
    openAllAccounts: () => {
      if (isReadingOverInbox(null)) {
        closeThread();

        return;
      }

      if (!isMailSearchActive && isShowingInbox(null)) {
        requestMailboxReload();

        return;
      }

      retainScope(null);
      selectAccountScope(null);
      showMailbox();
    },
    openMailbox: (accountId, nextMailbox) => {
      if (accountId !== selectedAccountId) {
        retainScope(accountId);
      }

      selectMailbox(accountId, nextMailbox);
      showMailbox();
    },
  };
};
