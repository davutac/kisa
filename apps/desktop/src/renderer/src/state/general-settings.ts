import { create } from "zustand";
import { persist } from "zustand/middleware";

interface GeneralSettingsState {
  openThreadsInNewWindows: boolean;
  setOpenThreadsInNewWindows: (value: boolean) => void;
}

export const useGeneralSettingsStore = create<GeneralSettingsState>()(
  persist(
    (set) => ({
      openThreadsInNewWindows: false,
      setOpenThreadsInNewWindows: (openThreadsInNewWindows) => {
        set({ openThreadsInNewWindows });
      },
    }),
    { name: "kisa:general-settings" }
  )
);

export const useOpenThreadsInNewWindows = (): boolean =>
  useGeneralSettingsStore((state) => state.openThreadsInNewWindows);
