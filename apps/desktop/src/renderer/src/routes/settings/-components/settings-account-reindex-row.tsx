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
  const titleId = `account-${accountId}-reindex-title`;
  const isIndexing =
    progress?.status === "queued" || progress?.status === "running";
  const isBusy = isStarting || isIndexing;

  const requestReindex = async (): Promise<void> => {
    if (isBusy) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Start reindex",
      description: (
        <ConfirmMessage subject={accountId}>
          Kisa will download all email conversations again, including Spam and
          Trash, to refresh your local history and search. This can consume
          substantial Gmail API quota and may take a long time for large
          accounts. Existing downloaded mail remains available. Use this only
          when mail is missing or out of date.
        </ConfirmMessage>
      ),
      title: "Reindex mail?",
    });

    if (!confirmed) {
      return;
    }

    setIsStarting(true);
    try {
      const reply = await mailApi.reindex({ accountId });

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      toast.success("Mail reindex started", {
        description: "Your existing downloaded mail remains available.",
      });
    } catch {
      toast.error("Could not start the mail reindex", {
        description: "Please try again.",
      });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>Mail history</SettingsRowTitle>
        <SettingsRowDescription>
          {isIndexing
            ? "Reindexing your complete Gmail history…"
            : "Refresh the local copy of your complete Gmail history."}
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
          aria-labelledby={titleId}
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
          Reindex
        </Button>
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountReindexRow;
