import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmMessage, useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { toMailIndexDescription } from "@/mail/mail-index-progress-view";
import { useAccountIndexProgress } from "@/mail/use-mail-index-progress";
import type { MailApi } from "@/platform/desktop";

interface SettingsAccountReindexRowProps {
  accountId: string;
  mailApi: MailApi;
}

const SettingsAccountReindexRow = ({
  accountId,
  mailApi,
}: SettingsAccountReindexRowProps) => {
  const confirm = useConfirm();
  const progress = useAccountIndexProgress(accountId);
  const [isStarting, setIsStarting] = useState(false);
  const isIndexing = progress?.status === "running";
  const isBusy = isStarting || isIndexing;

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
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle>Mail sync</SettingsRowTitle>
        <SettingsRowDescription>
          {toMailIndexDescription(progress)}
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
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
    </SettingsRow>
  );
};

export default SettingsAccountReindexRow;
