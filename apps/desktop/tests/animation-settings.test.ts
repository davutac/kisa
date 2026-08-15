import { describe, expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";

import { applyAnimationsClass } from "../src/renderer/src/lib/motion";
import { createGeneralSettingsStore } from "../src/renderer/src/state/general-settings";

const createMemoryStorage = (): StateStorage => {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
};

describe("animations setting", () => {
  it("enables animations by default", () => {
    const store = createGeneralSettingsStore(createMemoryStorage());

    expect(store.getState().animationsEnabled).toBeTruthy();
  });

  it("restores the animation preference after restart", () => {
    const storage = createMemoryStorage();
    const firstSession = createGeneralSettingsStore(storage);

    firstSession.getState().setAnimationsEnabled(false);

    const restartedSession = createGeneralSettingsStore(storage);
    expect(restartedSession.getState().animationsEnabled).toBeFalsy();
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
