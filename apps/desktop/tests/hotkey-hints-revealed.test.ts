import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHotkeyHintReveal,
  getModifierHold,
  HINT_REVEAL_DELAY_MS,
} from "../src/renderer/src/hotkeys/use-hotkey-hints-revealed";

const createHeldKeys = () => {
  let heldKeys: readonly string[] = [];
  const listeners = new Set<() => void>();

  return {
    hold: (...keys: readonly string[]): void => {
      heldKeys = keys;
      for (const listener of listeners) {
        listener();
      }
    },
    listenerCount: (): number => listeners.size,
    source: {
      getHeldKeys: () => heldKeys,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
};

describe(getModifierHold, () => {
  it("holds Command alone on macOS and Control alone elsewhere", () => {
    expect(getModifierHold(["Meta"], "mac")).toBe("alone");
    expect(getModifierHold(["Control"], "windows")).toBe("alone");
    expect(getModifierHold(["Control"], "linux")).toBe("alone");
  });

  it("treats the other platform's modifier as no hold", () => {
    expect(getModifierHold(["Control"], "mac")).toBe("none");
    expect(getModifierHold(["Meta"], "windows")).toBe("none");
    expect(getModifierHold([], "mac")).toBe("none");
  });

  it("treats any other held key as a chord", () => {
    expect(getModifierHold(["Meta", "1"], "mac")).toBe("chord");
    expect(getModifierHold(["Meta", "Shift"], "mac")).toBe("chord");
    expect(getModifierHold(["Control", "Alt"], "windows")).toBe("chord");
  });
});

describe(createHotkeyHintReveal, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reveals once Mod is held by itself for the delay, and hides on release", () => {
    const keys = createHeldKeys();
    const reveal = createHotkeyHintReveal(keys.source, "mac");
    const onChange = vi.fn<() => void>();
    reveal.subscribe(onChange);

    keys.hold("Meta");
    vi.advanceTimersByTime(HINT_REVEAL_DELAY_MS - 1);
    expect(reveal.isRevealed()).toBeFalsy();

    vi.advanceTimersByTime(1);
    expect(reveal.isRevealed()).toBeTruthy();

    keys.hold();
    expect(reveal.isRevealed()).toBeFalsy();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("never reveals for a chord pressed before the delay", () => {
    const keys = createHeldKeys();
    const reveal = createHotkeyHintReveal(keys.source, "mac");
    reveal.subscribe(vi.fn<() => void>());

    keys.hold("Meta");
    keys.hold("Meta", "C");
    vi.advanceTimersByTime(HINT_REVEAL_DELAY_MS * 2);

    expect(reveal.isRevealed()).toBeFalsy();
  });

  it("stays revealed through account chords until Mod is released", () => {
    const keys = createHeldKeys();
    const reveal = createHotkeyHintReveal(keys.source, "windows");
    reveal.subscribe(vi.fn<() => void>());

    keys.hold("Control");
    vi.advanceTimersByTime(HINT_REVEAL_DELAY_MS);
    keys.hold("Control", "2");
    expect(reveal.isRevealed()).toBeTruthy();

    keys.hold("Control");
    keys.hold("Control", "3");
    expect(reveal.isRevealed()).toBeTruthy();

    keys.hold();
    expect(reveal.isRevealed()).toBeFalsy();
  });

  it("stops listening without subscribers and waits the full delay again", () => {
    const keys = createHeldKeys();
    const reveal = createHotkeyHintReveal(keys.source, "mac");
    const unsubscribe = reveal.subscribe(vi.fn<() => void>());
    keys.hold("Meta");
    vi.advanceTimersByTime(HINT_REVEAL_DELAY_MS);

    unsubscribe();
    expect(keys.listenerCount()).toBe(0);
    expect(reveal.isRevealed()).toBeFalsy();

    reveal.subscribe(vi.fn<() => void>());
    vi.advanceTimersByTime(HINT_REVEAL_DELAY_MS - 1);
    expect(reveal.isRevealed()).toBeFalsy();

    vi.advanceTimersByTime(1);
    expect(reveal.isRevealed()).toBeTruthy();
  });
});
