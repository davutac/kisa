import { describe, expect, it } from "@effect/vitest";

import {
  getManualUpdateFeedback,
  getSettingsUpdateView,
  getTitlebarUpdateView,
} from "../src/renderer/src/updates/update-view";

describe("update view helpers", () => {
  it("hides titlebar updates for non-actionable states", () => {
    expect(getTitlebarUpdateView({ state: "idle" })).toStrictEqual({
      kind: "hidden",
    });
    expect(getTitlebarUpdateView({ state: "checking" })).toStrictEqual({
      kind: "hidden",
    });
    expect(getTitlebarUpdateView({ state: "unsupported" })).toStrictEqual({
      kind: "hidden",
    });
  });

  it("normalizes progress for the titlebar", () => {
    expect(
      getTitlebarUpdateView({
        percent: -1,
        state: "downloading",
        version: "1.2.3",
      })
    ).toStrictEqual({ kind: "progress", percent: 0 });
  });

  it("derives settings actions from update status", () => {
    expect(getSettingsUpdateView({ state: "idle" }, false)).toStrictEqual({
      action: "check",
      isBusy: false,
      isDisabled: false,
      label: "Check for Updates",
    });
    expect(
      getSettingsUpdateView({ state: "ready", version: "1.2.3" }, false)
    ).toStrictEqual({
      action: "install",
      isBusy: false,
      isDisabled: false,
      label: "Install Update",
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
  });
});
