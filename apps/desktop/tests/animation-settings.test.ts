import { describe, expect, it } from "vitest";

import { applyAnimationsClass } from "../src/renderer/src/lib/motion";
import {
  getAppSettingsState,
  hydrateAppSettingsState,
} from "../src/renderer/src/state/app-settings";
import { DEFAULT_APP_SETTINGS } from "../src/shared/ipc/app";

describe("animations setting", () => {
  it("enables animations by default", () => {
    hydrateAppSettingsState(DEFAULT_APP_SETTINGS);

    expect(getAppSettingsState().animationsEnabled).toBeTruthy();
  });

  it("hydrates the animation preference during app startup", () => {
    hydrateAppSettingsState({
      ...DEFAULT_APP_SETTINGS,
      animationsEnabled: false,
    });

    expect(getAppSettingsState().animationsEnabled).toBeFalsy();
  });

  it("adds and removes the reduced-animations document class", () => {
    const classes = new Set<string>();
    const documentElement = {
      classList: {
        toggle: (name: string, force?: boolean) => {
          if (force) {
            classes.add(name);
          } else {
            classes.delete(name);
          }

          return classes.has(name);
        },
      },
    };

    applyAnimationsClass(documentElement, false);
    expect(classes.has("reduce-animations")).toBeTruthy();

    applyAnimationsClass(documentElement, true);
    expect(classes.has("reduce-animations")).toBeFalsy();
  });
});
