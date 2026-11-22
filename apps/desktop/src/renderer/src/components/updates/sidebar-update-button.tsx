import {
  CheckIcon,
  DownloadIcon,
  RefreshCwIcon,
  RotateCwIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UpdateApi } from "@/platform/desktop";
import { getSidebarUpdateView } from "@/updates/update-view";
import type { SidebarUpdateView } from "@/updates/update-view";
import { useUpdateActions } from "@/updates/use-update-actions";
import { useUpdateStatus } from "@/updates/use-update-status";

/** Fits the ring just inside the 32px button. */
const PROGRESS_RADIUS = 14;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

const DownloadProgressRing = ({ percent }: { readonly percent: number }) => (
  <svg
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 size-full -rotate-90"
    viewBox="0 0 32 32"
  >
    <circle
      className="stroke-current/20"
      cx="16"
      cy="16"
      fill="none"
      r={PROGRESS_RADIUS}
      strokeWidth="1.5"
    />
    <circle
      className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
      cx="16"
      cy="16"
      fill="none"
      r={PROGRESS_RADIUS}
      stroke="currentColor"
      strokeDasharray={PROGRESS_CIRCUMFERENCE}
      strokeDashoffset={PROGRESS_CIRCUMFERENCE * (1 - percent / 100)}
      strokeLinecap="round"
      strokeWidth="1.5"
    />
  </svg>
);

const UpdateStatusIcon = ({ view }: { readonly view: SidebarUpdateView }) => {
  if (view.kind === "download") {
    return (
      <span className="relative grid size-4 place-items-center">
        <DownloadIcon className="size-4 stroke-[1.8]" />
        <span
          aria-hidden="true"
          className="ring-sidebar-accent absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current ring-2"
        />
      </span>
    );
  }

  if (view.kind === "progress") {
    return (
      <>
        <DownloadProgressRing percent={view.percent} />
        <DownloadIcon className="size-4 stroke-[1.8]" />
      </>
    );
  }

  if (view.kind === "install") {
    return (
      <span className="relative grid size-4 place-items-center">
        <RotateCwIcon className="size-4 stroke-[1.8]" />
        <span className="bg-sidebar-foreground text-sidebar ring-sidebar-accent absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full ring-2">
          <CheckIcon className="size-2" strokeWidth={3} />
        </span>
      </span>
    );
  }

  return (
    <RefreshCwIcon
      className={cn(
        "size-4 stroke-[1.8]",
        view.kind === "check" && view.isChecking
          ? "animate-spin motion-reduce:animate-none"
          : undefined
      )}
    />
  );
};

/**
 * The round update control at the trailing end of the sidebar footer. While
 * nothing is pending it checks for updates; once an update exists it fills
 * in and walks through download, progress, and restart to install.
 */
// oxlint-disable-next-line sonarjs/function-name
const SidebarUpdateButton = ({
  updateApi,
}: {
  readonly updateApi: UpdateApi;
}) => {
  const status = useUpdateStatus(updateApi);
  const { checkForUpdates, downloadUpdate, installUpdate, isCheckPending } =
    useUpdateActions(updateApi);
  const view = getSidebarUpdateView(status, isCheckPending);

  if (view.kind === "hidden") {
    return null;
  }

  const isBusy =
    view.kind === "progress" || (view.kind === "check" && view.isChecking);
  const hasUpdate = view.kind !== "check";

  const handleClick = (): void => {
    if (view.kind === "check" && !view.isChecking) {
      void checkForUpdates();
    } else if (view.kind === "download") {
      void downloadUpdate();
    } else if (view.kind === "install") {
      void installUpdate(view.version);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-disabled={isBusy ? true : undefined}
            aria-label={view.label}
            className={cn(
              "relative rounded-full",
              hasUpdate
                ? "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent/80"
                : "text-muted-foreground hover:text-foreground",
              isBusy ? "cursor-default" : undefined
            )}
            onClick={handleClick}
            size="icon-lg"
            type="button"
            variant="ghost"
          >
            <UpdateStatusIcon view={view} />
          </Button>
        }
      />
      <TooltipContent side="top">{view.label}</TooltipContent>
    </Tooltip>
  );
};

export default SidebarUpdateButton;
