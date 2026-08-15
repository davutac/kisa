import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";

interface GeneralSettingsState {
  animationsEnabled: boolean;
  openThreadsInNewWindows: boolean;
  setAnimationsEnabled: (value: boolean) => void;
  setOpenThreadsInNewWindows: (value: boolean) => void;
}

export const createGeneralSettingsStore = (storage?: StateStorage) =>
  create<GeneralSettingsState>()(
    persist(
      (set) => ({
        animationsEnabled: true,
        openThreadsInNewWindows: false,
        setAnimationsEnabled: (animationsEnabled) => {
          set({ animationsEnabled });
        },
        setOpenThreadsInNewWindows: (openThreadsInNewWindows) => {
          set({ openThreadsInNewWindows });
        },
      }),
      {
        name: "kisa:general-settings",
        storage: createJSONStorage(() => storage ?? window.localStorage),
      }
    )
  );

export const useGeneralSettingsStore = createGeneralSettingsStore();

export const useAnimationsEnabled = (): boolean =>
  useGeneralSettingsStore((state) => state.animationsEnabled);

export const useOpenThreadsInNewWindows = (): boolean =>
  useGeneralSettingsStore((state) => state.openThreadsInNewWindows);
