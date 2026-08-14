import type { UpdateStatus } from "@/shared/update-status";
import { clampUpdateProgress } from "@/shared/update-status";

export type TitlebarUpdateView =
  | { kind: "hidden" }
  | {
      kind: "download" | "install";
      label: string;
      version: string;
    }
  | { kind: "progress"; percent: number };

export type SettingsUpdateView =
  | {
      action: "check";
      isBusy: boolean;
      isDisabled: boolean;
      label: string;
    }
  | {
      action: "download" | "install";
      label: string;
      version: string;
    };

export interface ManualUpdateFeedback {
  description: string;
  title: string;
  type: "info" | "success";
}

export const getTitlebarUpdateView = (
  status: UpdateStatus
): TitlebarUpdateView => {
  if (
    status.state === "idle" ||
    status.state === "checking" ||
    status.state === "unsupported"
  ) {
    return { kind: "hidden" };
  }

  if (status.state === "downloading") {
    return {
      kind: "progress",
      percent: clampUpdateProgress(status.percent),
    };
  }

  if (status.state === "available") {
    return {
      kind: "download",
      label: "Update",
      version: status.version,
    };
  }

  return {
    kind: "install",
    label: "Install",
    version: status.version,
  };
};

export const getSettingsUpdateView = (
  status: UpdateStatus,
  isManualCheckPending: boolean
): SettingsUpdateView => {
  if (status.state === "available") {
    return {
      action: "download",
      label: "Download Update",
      version: status.version,
    };
  }

  if (status.state === "ready") {
    return {
      action: "install",
      label: "Install Update",
      version: status.version,
    };
  }

  const isChecking = status.state === "checking" || isManualCheckPending;
  const isDownloading = status.state === "downloading";
  const isUnsupported = status.state === "unsupported";

  if (isChecking) {
    return {
      action: "check",
      isBusy: true,
      isDisabled: true,
      label: "Checking",
    };
  }

  if (isDownloading) {
    return {
      action: "check",
      isBusy: true,
      isDisabled: true,
      label: "Downloading",
    };
  }

  if (isUnsupported) {
    return {
      action: "check",
      isBusy: false,
      isDisabled: true,
      label: "Unavailable",
    };
  }

  return {
    action: "check",
    isBusy: false,
    isDisabled: false,
    label: "Check for Updates",
  };
};

export const getManualUpdateFeedback = (
  status: UpdateStatus
): ManualUpdateFeedback | null => {
  if (status.state === "idle") {
    return {
      description: "No update is available right now.",
      title: "You're up to date",
      type: "success",
    };
  }

  if (status.state === "available") {
    return {
      description: `Version ${status.version} is available to download.`,
      title: "Update found",
      type: "info",
    };
  }

  if (status.state === "downloading") {
    return {
      description: `Downloading version ${status.version}.`,
      title: "Update found",
      type: "info",
    };
  }

  if (status.state === "ready") {
    return {
      description: `Version ${status.version} can be installed now.`,
      title: "Update ready",
      type: "success",
    };
  }

  return null;
};
