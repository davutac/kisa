import { useLocation, useNavigate } from "@tanstack/react-router";

import { retainMailboxThreadsSnapshotsForAccounts } from "@/mail/mailbox-cache";
import { requestMailboxReload } from "@/mail/mailbox-reload";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useMailboxStore } from "@/state/mailbox";

export interface MailboxNavigation {
  /** Filters the mailbox down to a single account, reloading it when already there. */
  openAccount: (accountEmail: string) => void;
  /** Clears the account filter, reloading the mailbox when already unfiltered. */
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
  const selectedAccountId = useMailboxStore((state) => state.selectedAccountId);
  const selectAccount = useMailboxStore((state) => state.selectAccount);
  const isMailboxRoute = pathname === "/";

  const showMailbox = (): void => {
    if (!isMailboxRoute) {
      void navigate({ to: "/" });
    }
  };

  return {
    openAccount: (accountEmail) => {
      if (isMailboxRoute && selectedAccountId === accountEmail) {
        requestMailboxReload();
        return;
      }

      retainMailboxThreadsSnapshotsForAccounts([accountEmail]);
      selectAccount(accountEmail);
      showMailbox();
    },
    openAllAccounts: () => {
      if (isMailboxRoute && selectedAccountId === null) {
        requestMailboxReload();
        return;
      }

      retainMailboxThreadsSnapshotsForAccounts(
        accounts.map(({ email }) => email)
      );
      selectAccount(null);
      showMailbox();
    },
  };
};
