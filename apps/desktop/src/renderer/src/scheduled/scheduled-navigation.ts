import { create } from "zustand";

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
