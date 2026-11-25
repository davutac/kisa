import { KeyRoundIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmMessage, useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { toast } from "@/components/ui/toast";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { toMailIndexDescription } from "@/mail/mail-index-progress-view";
import { useAccountIndexProgress } from "@/mail/use-mail-index-progress";
import type { AccountsApi, MailApi } from "@/platform/desktop";

import { toAccountSettingsPage } from "./settings-pages";
import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

interface SettingsAccountReindexRowProps {
  accountId: string;
  accountsApi: AccountsApi;
  mailApi: MailApi;
}

const SettingsAccountReindexRow = ({
  accountId,
  accountsApi,
  mailApi,
}: SettingsAccountReindexRowProps) => {
  const confirm = useConfirm();
  const progress = useAccountIndexProgress(accountId);
  const [isStarting, setIsStarting] = useState(false);
  const isIndexing = progress?.status === "running";
  const isBusy = isStarting || isIndexing;
  // The account's sign-in was refused. Main opens the window that fits it:
  // a new app password, or Microsoft in the browser.
  const needsSignIn = progress?.status === "paused";

  const signInAgain = async (): Promise<void> => {
    try {
      const reply = await accountsApi.openAccountSignIn({ email: accountId });
      if (!reply.ok) {
        toast.error(reply.error);
      }
    } catch {
      toast.error("Could not open sign-in");
    }
  };

  const requestReindex = async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Sync now",
      description: (
        <ConfirmMessage subject={accountId}>
          Kisa will check the mail server for new mail and changes now. It
          already keeps this account up to date on its own, so nothing is
          downloaded again or deleted.
        </ConfirmMessage>
      ),
      title: "Check for new mail now?",
    });

    if (!confirmed) {
      return;
    }

    setIsStarting(true);
    await runWithCleanup(
      async () => {
        try {
          const reply = await mailApi.reindex({ accountId });

          if (!reply.ok) {
            toast.error(reply.error);
            return;
          }

          toast.success("Checking for new mail");
        } catch {
          toast.error("Could not check for new mail", {
            description: "Please try again.",
          });
        }
      },
      () => {
        setIsStarting(false);
      }
    );
  };

  return (
    <SearchableSettingsRow
      target={toSettingsTarget(toAccountSettingsPage(accountId), "mail-sync")}
    >
      <SettingsRowContent>
        <SettingsRowTitle>Mail sync</SettingsRowTitle>
        <SettingsRowDescription>
          {toMailIndexDescription(progress)}
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        {needsSignIn ? (
          <Button
            aria-label={`Sign in again for ${accountId}`}
            onClick={() => {
              void signInAgain();
            }}
            type="button"
          >
            <KeyRoundIcon />
            Sign in again
          </Button>
        ) : null}
        <Button
          aria-label={`Sync now for ${accountId}`}
          disabled={isBusy}
          onClick={() => {
            void requestReindex();
          }}
          type="button"
          variant="secondary"
        >
          {isBusy ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          Sync now
        </Button>
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsAccountReindexRow;
