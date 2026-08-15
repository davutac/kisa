import { useLocation, useNavigate } from "@tanstack/react-router";

import { retainMailboxThreadsSnapshotsForAccounts } from "@/mail/mailbox-cache";
import { requestMailboxReload } from "@/mail/mailbox-reload";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useMailboxStore } from "@/state/mailbox";

export interface MailboxNavigation {
  /** Shows one account's inbox, reloading it when already shown. */
  openAccount: (accountEmail: string) => void;
  /** Shows the combined inbox, reloading it when already shown. */
  openAllAccounts: () => void;
}

/**
 * The titlebar account switcher, shared by its buttons and their number
 * hotkeys so both routes through it behave identically.
 */
export const useMailboxNavigation = (): MailboxNavigation => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const accounts = useGoogleAccounts();
  const mailbox = useMailboxStore((state) => state.mailbox);
  const openThreadId = useMailboxStore((state) => state.openThreadId);
  const selectedAccountId = useMailboxStore((state) => state.selectedAccountId);
  const selectInbox = useMailboxStore((state) => state.selectInbox);
  const showUnread = useMailboxStore((state) => state.showUnread);
  const isMailboxRoute = pathname === "/";

  const showMailbox = (): void => {
    if (!isMailboxRoute) {
      void navigate({ to: "/" });
    }
  };
  const isShowingInbox = (accountId: string | null): boolean =>
    isMailboxRoute &&
    selectedAccountId === accountId &&
    mailbox === "inbox" &&
    openThreadId === null &&
    !showUnread;

  return {
    openAccount: (accountEmail) => {
      if (isShowingInbox(accountEmail)) {
        requestMailboxReload();
        return;
      }

      retainMailboxThreadsSnapshotsForAccounts([accountEmail]);
      selectInbox(accountEmail);
      showMailbox();
    },
    openAllAccounts: () => {
      if (isShowingInbox(null)) {
        requestMailboxReload();
        return;
      }

      retainMailboxThreadsSnapshotsForAccounts(
        accounts.map(({ email }) => email)
      );
      selectInbox(null);
      showMailbox();
    },
  };
};
