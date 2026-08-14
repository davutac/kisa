import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { UpdateApi } from "@/platform/desktop";
import {
  getManualUpdateFeedback,
  getSettingsUpdateView,
} from "@/updates/update-view";
import { useUpdateActions } from "@/updates/use-update-actions";
import { useUpdateStatus } from "@/updates/use-update-status";

interface SettingsUpdateRowProps {
  updateApi: UpdateApi;
}

const showManualUpdateFeedback = (
  feedback: ReturnType<typeof getManualUpdateFeedback>
): void => {
  if (feedback === null) {
    return;
  }

  toast[feedback.type](feedback.title, {
    description: feedback.description,
  });
};

const SettingsUpdateRow = ({ updateApi }: SettingsUpdateRowProps) => {
  const status = useUpdateStatus(updateApi);
  const [isManualCheckPending, setIsManualCheckPending] = useState(false);
  const { downloadUpdate, installUpdate } = useUpdateActions(updateApi);

  const handleCheckForUpdates = async (): Promise<void> => {
    setIsManualCheckPending(true);

    try {
      const nextStatus = await updateApi.check();
      showManualUpdateFeedback(getManualUpdateFeedback(nextStatus));
    } catch {
      toast.error("Could not check for updates", {
        description: "Please try again later.",
      });
    } finally {
      setIsManualCheckPending(false);
    }
  };

  const view = getSettingsUpdateView(status, isManualCheckPending);

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id="updates-title">Updates</SettingsRowTitle>
        <SettingsRowDescription id="updates-description">
          Check whether a newer version is available
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        {view.action === "check" ? (
          <Button
            aria-describedby="updates-description"
            aria-labelledby="updates-title"
            disabled={view.isDisabled}
            onClick={() => {
              void handleCheckForUpdates();
            }}
            type="button"
            variant="secondary"
          >
            {view.isBusy ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            <span>{view.label}</span>
          </Button>
        ) : (
          <Button
            aria-describedby="updates-description"
            aria-labelledby="updates-title"
            onClick={() => {
              if (view.action === "download") {
                void downloadUpdate();
                return;
              }

              void installUpdate(view.version);
            }}
            type="button"
            variant="secondary"
          >
            <DownloadIcon />
            <span>{view.label}</span>
          </Button>
        )}
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsUpdateRow;
