import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { UpdateApi } from "@/platform/desktop";
import { getTitlebarUpdateView } from "@/updates/update-view";
import type { TitlebarUpdateView } from "@/updates/update-view";

type UpdateStatus = Awaited<ReturnType<UpdateApi["getStatus"]>>;

interface TitlebarUpdateButtonProps {
  updateApi: UpdateApi;
}

const renderUpdateButton = (view: TitlebarUpdateView, updateApi: UpdateApi) => {
  if (view.kind === "hidden") {
    return null;
  }

  if (view.kind === "progress") {
    return (
      <Button
        aria-live="polite"
        className="app-titlebar-interactive bg-blue-400 text-white"
        disabled
        size="icon"
        type="button"
      >
        <LoaderCircleIcon className="animate-spin" />
        <span className="sr-only">Downloading {view.percent}%</span>
      </Button>
    );
  }

  return (
    <Button
      className="app-titlebar-interactive bg-blue-400 text-white"
      onClick={() => {
        void updateApi.install();
      }}
      type="button"
    >
      <DownloadIcon />
      <span>{view.label}</span>
    </Button>
  );
};

// oxlint-disable-next-line sonarjs/function-name
const TitlebarUpdateButton = ({ updateApi }: TitlebarUpdateButtonProps) => {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

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

  return renderUpdateButton(getTitlebarUpdateView(status), updateApi);
};

export default TitlebarUpdateButton;
