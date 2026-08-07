import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";
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

type UpdateStatus = Awaited<ReturnType<UpdateApi["getStatus"]>>;

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
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [isManualCheckPending, setIsManualCheckPending] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadStatus = async (): Promise<void> => {
      const currentStatus = await updateApi.getStatus();

      if (isMounted) {
        setStatus(currentStatus);
      }
    };

    void loadStatus();

    const unsubscribe = updateApi.onStatusChange((nextStatus) => {
      setStatus(nextStatus);
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [updateApi]);

  const handleCheckForUpdates = async (): Promise<void> => {
    setIsManualCheckPending(true);

    try {
      const nextStatus = await updateApi.check();
      setStatus(nextStatus);
      showManualUpdateFeedback(getManualUpdateFeedback(nextStatus));
    } catch {
      toast.error("Could not check for updates", {
        description: "Please try again later.",
      });
    } finally {
      setIsManualCheckPending(false);
    }
  };

  const handleInstallUpdate = (): void => {
    void updateApi.install();
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
        {view.action === "install" ? (
          <Button
            aria-describedby="updates-description"
            aria-labelledby="updates-title"
            onClick={handleInstallUpdate}
            type="button"
          >
            <DownloadIcon />
            <span>{view.label}</span>
          </Button>
        ) : (
          <Button
            aria-describedby="updates-description"
            aria-labelledby="updates-title"
            disabled={view.isDisabled}
            onClick={() => {
              void handleCheckForUpdates();
            }}
            type="button"
            variant="outline"
          >
            {view.isBusy ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            <span>{view.label}</span>
          </Button>
        )}
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsUpdateRow;
