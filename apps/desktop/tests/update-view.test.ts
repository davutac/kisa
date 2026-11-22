import { describe, expect, it } from "@effect/vitest";

import {
  getManualUpdateFeedback,
  getSettingsUpdateView,
  getSidebarUpdateView,
} from "../src/renderer/src/updates/update-view";

describe("update view helpers", () => {
  it("hides the sidebar button only where updates are unsupported", () => {
    expect(getSidebarUpdateView({ state: "unsupported" }, false)).toStrictEqual(
      { kind: "hidden" }
    );
  });

  it("offers a sidebar check while idle and spins it while checking", () => {
    expect(getSidebarUpdateView({ state: "idle" }, false)).toStrictEqual({
      isChecking: false,
      kind: "check",
      label: "Check for updates",
    });
    expect(getSidebarUpdateView({ state: "checking" }, false)).toStrictEqual({
      isChecking: true,
      kind: "check",
      label: "Checking for updates…",
    });
    expect(getSidebarUpdateView({ state: "idle" }, true)).toStrictEqual({
      isChecking: true,
      kind: "check",
      label: "Checking for updates…",
    });
  });

  it("normalizes download progress for the sidebar", () => {
    expect(
      getSidebarUpdateView(
        { percent: -1, state: "downloading", version: "1.2.3" },
        false
      )
    ).toStrictEqual({
      kind: "progress",
      label: "Downloading update (0%)",
      percent: 0,
    });
  });

  it("shows separate sidebar actions for downloading and installing", () => {
    expect(
      getSidebarUpdateView({ state: "available", version: "1.2.3" }, false)
    ).toStrictEqual({
      kind: "download",
      label: "Download update 1.2.3",
      version: "1.2.3",
    });
    expect(
      getSidebarUpdateView({ state: "ready", version: "1.2.3" }, false)
    ).toStrictEqual({
      kind: "install",
      label: "Restart to install update 1.2.3",
      version: "1.2.3",
    });
  });

  it("derives settings actions from update status", () => {
    expect(getSettingsUpdateView({ state: "idle" }, false)).toStrictEqual({
      action: "check",
      isBusy: false,
      isDisabled: false,
      label: "Check for Updates",
    });
    expect(
      getSettingsUpdateView({ state: "available", version: "1.2.3" }, false)
    ).toStrictEqual({
      action: "download",
      label: "Download Update",
      version: "1.2.3",
    });
    expect(
      getSettingsUpdateView({ state: "ready", version: "1.2.3" }, false)
    ).toStrictEqual({
      action: "install",
      label: "Install Update",
      version: "1.2.3",
    });
    expect(
      getSettingsUpdateView({ state: "unsupported" }, false)
    ).toStrictEqual({
      action: "check",
      isBusy: false,
      isDisabled: true,
      label: "Unavailable",
    });
  });

  it("centralizes manual update feedback", () => {
    expect(getManualUpdateFeedback({ state: "checking" })).toBeNull();
    expect(getManualUpdateFeedback({ state: "idle" })).toStrictEqual({
      description: "No update is available right now.",
      title: "You're up to date",
      type: "success",
    });
    expect(
      getManualUpdateFeedback({ state: "available", version: "1.2.3" })
    ).toStrictEqual({
      description: "Version 1.2.3 is available to download.",
      title: "Update found",
      type: "info",
    });
  });
});
