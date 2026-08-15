import { create } from "zustand";
import { persist } from "zustand/middleware";

interface GeneralSettingsState {
  animationsEnabled: boolean;
  openThreadsInNewWindows: boolean;
  setAnimationsEnabled: (value: boolean) => void;
  setOpenThreadsInNewWindows: (value: boolean) => void;
}

export const useGeneralSettingsStore = create<GeneralSettingsState>()(
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
    { name: "kisa:general-settings" }
  )
);

export const useAnimationsEnabled = (): boolean =>
  useGeneralSettingsStore((state) => state.animationsEnabled);

export const useOpenThreadsInNewWindows = (): boolean =>
  useGeneralSettingsStore((state) => state.openThreadsInNewWindows);
