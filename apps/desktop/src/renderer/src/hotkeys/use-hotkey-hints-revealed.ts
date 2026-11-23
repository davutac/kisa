import { useSyncExternalStore } from "react";

import { useIsHotkeyScopeActive } from "@/hotkeys/app-hotkeys-provider";
import { getHotkeyModifierKey } from "@/hotkeys/commands";
import type { HotkeyPlatform } from "@/hotkeys/commands";

/**
 * How `Mod` is held: not at all, by itself, or as part of a chord such as
 * `Mod+C`, AltGr (`Control+Alt` on Windows), or `Mod+Shift`.
 */
export type ModifierHold = "alone" | "chord" | "none";

/** Long enough that an ordinary `Mod` chord never flashes the hints. */
export const HINT_REVEAL_DELAY_MS = 400;

export const getModifierHold = (
  heldKeys: readonly string[],
  platform?: HotkeyPlatform
): ModifierHold => {
  if (!heldKeys.includes(getHotkeyModifierKey(platform))) {
    return "none";
  }

  return heldKeys.length === 1 ? "alone" : "chord";
};

export interface HeldKeysSource {
  readonly getHeldKeys: () => readonly string[];
  readonly subscribe: (onChange: () => void) => () => void;
}

export interface HotkeyHintReveal {
  readonly isRevealed: () => boolean;
  readonly subscribe: (onChange: () => void) => () => void;
}

/**
 * Reveals hints once `Mod` has been held by itself for the delay. Another
 * key before then cancels the reveal, so chords never flash it; once shown,
 * the hints stay until `Mod` is released, so `Mod+2` then `Mod+3` can hop
 * between accounts under one hold. It listens to keys only while subscribed
 * and forgets a reveal when the last subscriber leaves.
 */
export const createHotkeyHintReveal = (
  keys: HeldKeysSource,
  platform?: HotkeyPlatform
): HotkeyHintReveal => {
  const listeners = new Set<() => void>();
  let isRevealed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeFromKeys: (() => void) | undefined;

  const cancelPendingReveal = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const setRevealed = (next: boolean): void => {
    if (next === isRevealed) {
      return;
    }
    isRevealed = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const syncWithHeldKeys = (): void => {
    const hold = getModifierHold(keys.getHeldKeys(), platform);

    if (hold !== "alone") {
      cancelPendingReveal();
    }
    if (hold === "none") {
      setRevealed(false);
    } else if (hold === "alone" && !isRevealed && timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        setRevealed(true);
      }, HINT_REVEAL_DELAY_MS);
    }
  };

  return {
    isRevealed: () => isRevealed,
    subscribe: (listener) => {
      listeners.add(listener);
      if (unsubscribeFromKeys === undefined) {
        unsubscribeFromKeys = keys.subscribe(syncWithHeldKeys);
        syncWithHeldKeys();
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          unsubscribeFromKeys?.();
          unsubscribeFromKeys = undefined;
          cancelPendingReveal();
          isRevealed = false;
        }
      };
    },
  };
};

const MODIFIER_FLAGS = {
  Alt: "altKey",
  Control: "ctrlKey",
  Meta: "metaKey",
  Shift: "shiftKey",
} as const;

const isModifier = (key: string): key is keyof typeof MODIFIER_FLAGS =>
  Object.hasOwn(MODIFIER_FLAGS, key);

export const createHeldKeys = (
  target: Window,
  platform?: HotkeyPlatform
): HeldKeysSource => {
  const held = new Map<string, string>();
  const listeners = new Set<() => void>();
  let heldKeys: readonly string[] = [];

  const publish = (): void => {
    const next = [...new Set(held.values())];
    if (
      next.length === heldKeys.length &&
      next.every((key, index) => key === heldKeys[index])
    ) {
      return;
    }
    heldKeys = next;
    for (const listener of listeners) {
      listener();
    }
  };
  // A modifier released where the window didn't hear it still reads as held
  // until a real key event says otherwise.
  const forgetReleasedModifiers = (event: KeyboardEvent): void => {
    if (!event.isTrusted) {
      return;
    }
    for (const [code, key] of held) {
      if (isModifier(key) && !event[MODIFIER_FLAGS[key]]) {
        held.delete(code);
      }
    }
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    forgetReleasedModifiers(event);
    held.set(event.code || event.key, event.key);
    publish();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    held.delete(event.code || event.key);
    forgetReleasedModifiers(event);
    // macOS sends no keyup for a key released while ⌘ is down.
    if (event.key === "Meta" && getHotkeyModifierKey(platform) === "Meta") {
      for (const [code, key] of held) {
        if (!isModifier(key)) {
          held.delete(code);
        }
      }
    }
    publish();
  };
  const forgetAll = (): void => {
    held.clear();
    publish();
  };
  const onVisibilityChange = (): void => {
    if (target.document.hidden) {
      forgetAll();
    }
  };

  return {
    getHeldKeys: () => heldKeys,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) {
        target.addEventListener("keydown", onKeyDown, true);
        target.addEventListener("keyup", onKeyUp, true);
        target.addEventListener("blur", forgetAll);
        target.document.addEventListener(
          "visibilitychange",
          onVisibilityChange
        );
      }

      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) {
          return;
        }
        target.removeEventListener("keydown", onKeyDown, true);
        target.removeEventListener("keyup", onKeyUp, true);
        target.removeEventListener("blur", forgetAll);
        target.document.removeEventListener(
          "visibilitychange",
          onVisibilityChange
        );
        held.clear();
        heldKeys = [];
      };
    },
  };
};

let appHintReveal: HotkeyHintReveal | undefined;

const getAppHintReveal = (): HotkeyHintReveal => {
  appHintReveal ??= createHotkeyHintReveal(createHeldKeys(window));
  return appHintReveal;
};

const subscribeToAppHintReveal = (onChange: () => void): (() => void) =>
  getAppHintReveal().subscribe(onChange);
const readAppHintReveal = (): boolean => getAppHintReveal().isRevealed();
const readServerHintReveal = (): boolean => false;

/**
 * Whether holding `Mod` has asked to see shortcut hints. Only while the `app`
 * scope is active, because a composer or dialog above gives the same keys
 * other meanings.
 */
export const useHotkeyHintsRevealed = (enabled: boolean): boolean => {
  const isAppScopeActive = useIsHotkeyScopeActive("app");
  const isRevealed = useSyncExternalStore(
    subscribeToAppHintReveal,
    readAppHintReveal,
    readServerHintReveal
  );

  return enabled && isAppScopeActive && isRevealed;
};
