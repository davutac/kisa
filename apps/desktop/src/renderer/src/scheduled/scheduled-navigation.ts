import { create } from "zustand";

import type { ThreadSelectionDirection } from "@/mail/thread-selection";
import { getNextThreadSelectionIndex } from "@/mail/thread-selection";

interface ScheduledMailFocusTarget {
  readonly focus: () => void;
}

export const focusScheduledMailTarget = (
  key: string | null,
  rowTargets: ReadonlyMap<string, ScheduledMailFocusTarget>,
  fallbackTarget: ScheduledMailFocusTarget | null
): void => {
  const rowTarget = key === null ? undefined : rowTargets.get(key);
  (rowTarget ?? fallbackTarget)?.focus();
};

export const getScheduledMailSelectionIndex = (
  itemKeys: readonly string[],
  selectedKey: string | null,
  visibleIndex: number | null,
  direction: ThreadSelectionDirection
): number | null => {
  if (itemKeys.length === 0) {
    return null;
  }

  const hasSelectedItem =
    selectedKey !== null && itemKeys.includes(selectedKey);

  return (
    (hasSelectedItem ? null : visibleIndex) ??
    getNextThreadSelectionIndex(itemKeys, selectedKey, direction)
  );
};

interface ScheduledMailNavigationTarget {
  readonly accountId: string;
  readonly draftId: string;
}

interface ScheduledMailNavigationState {
  target: ScheduledMailNavigationTarget | null;
  clear: () => void;
  requestOpen: (target: ScheduledMailNavigationTarget) => void;
}

export const useScheduledMailNavigation =
  create<ScheduledMailNavigationState>()((set) => ({
    clear: () => set({ target: null }),
    requestOpen: (target) => set({ target }),
    target: null,
  }));
