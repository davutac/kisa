import { LoaderCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { UpdateApi } from "@/platform/desktop";
import { getTitlebarUpdateView } from "@/updates/update-view";
import type { TitlebarUpdateView } from "@/updates/update-view";
import { useUpdateActions } from "@/updates/use-update-actions";
import { useUpdateStatus } from "@/updates/use-update-status";

interface TitlebarUpdateButtonProps {
  updateApi: UpdateApi;
}

const renderUpdateButton = (
  view: TitlebarUpdateView,
  downloadUpdate: () => Promise<void>,
  installUpdate: (version: string) => Promise<void>
) => {
  if (view.kind === "hidden") {
    return null;
  }

  if (view.kind === "progress") {
    return (
      <Button
        aria-live="polite"
        className="app-titlebar-interactive bg-blue-400 text-black hover:bg-blue-400/80"
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
      className="app-titlebar-interactive bg-blue-400 text-black hover:bg-blue-400/80"
      onClick={() => {
        if (view.kind === "download") {
          void downloadUpdate();
          return;
        }

        void installUpdate(view.version);
      }}
      type="button"
    >
      <span>{view.label}</span>
    </Button>
  );
};

// oxlint-disable-next-line sonarjs/function-name
const TitlebarUpdateButton = ({ updateApi }: TitlebarUpdateButtonProps) => {
  const status = useUpdateStatus(updateApi);
  const { downloadUpdate, installUpdate } = useUpdateActions(updateApi);

  return renderUpdateButton(
    getTitlebarUpdateView(status),
    downloadUpdate,
    installUpdate
  );
};

export default TitlebarUpdateButton;
