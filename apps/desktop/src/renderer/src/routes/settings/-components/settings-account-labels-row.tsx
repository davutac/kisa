import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import MailRelativeTime from "@/components/mail/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { MailApi } from "@/platform/desktop";
import type { GmailLabelCatalog, GmailLabelSummary } from "@/shared/ipc/mail";

// Gmail owns the labels it names itself; the ones worth listing here are the
// labels the account holder created.
const isUserLabel = (label: GmailLabelSummary): boolean =>
  label.type !== "system";

interface SettingsAccountLabelsRowProps {
  accountId: string;
  mailApi: MailApi;
}

const SettingsAccountLabelsRow = ({
  accountId,
  mailApi,
}: SettingsAccountLabelsRowProps) => {
  const [catalog, setCatalog] = useState<GmailLabelCatalog>();
  const [isSyncing, setIsSyncing] = useState(false);
  const titleId = `account-${accountId}-labels-title`;

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      try {
        const reply = await mailApi.listLabels({ accountId });

        if (isMounted && reply.ok) {
          setCatalog(reply.data);
        }
      } catch {
        // Syncing is the retry: a failed read leaves the row empty, not broken.
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [accountId, mailApi]);

  const handleSync = async (): Promise<void> => {
    setIsSyncing(true);

    try {
      const reply = await mailApi.syncLabels({ accountId });

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      setCatalog(reply.data);
      toast.success("Gmail labels synced");
    } catch {
      toast.error("Could not sync the labels", {
        description: "Please try again.",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const labels = (catalog?.labels ?? []).filter(isUserLabel);

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>Labels</SettingsRowTitle>
        <SettingsRowDescription>
          {catalog === undefined
            ? "Loading labels…"
            : `${labels.length} label${labels.length === 1 ? "" : "s"} of your own`}
          {catalog?.syncedAt === undefined ? null : (
            <>
              {" · synced "}
              <MailRelativeTime timestamp={catalog.syncedAt} />
            </>
          )}
        </SettingsRowDescription>
        {labels.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            {labels.map((label) => (
              <Badge
                className="bg-muted text-muted-foreground max-w-40"
                key={label.id}
                title={label.name}
                variant="secondary"
              >
                <span className="truncate">{label.name}</span>
              </Badge>
            ))}
          </div>
        )}
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
          aria-labelledby={titleId}
          disabled={isSyncing}
          onClick={() => {
            void handleSync();
          }}
          type="button"
          variant="secondary"
        >
          {isSyncing ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          <span>Sync</span>
        </Button>
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountLabelsRow;
