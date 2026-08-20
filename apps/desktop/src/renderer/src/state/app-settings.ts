import { useCallback } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { AppSettingsApi } from "@/platform/desktop";
import { DEFAULT_APP_SETTINGS } from "@/shared/ipc/app";
import type { AppSettings } from "@/shared/ipc/app";

export interface UseAppSettings extends AppSettings {
  readonly setAnimationsEnabled: (enabled: boolean) => void;
  readonly setOpenThreadsInNewWindows: (enabled: boolean) => void;
  readonly setRunInBackground: (enabled: boolean) => void;
  readonly setLaunchAtLogin: (enabled: boolean) => void;
}

const appSettingsStore = createStore<AppSettings>()(() => DEFAULT_APP_SETTINGS);
let updateVersion = 0;

export const getAppSettingsState = (): AppSettings =>
  appSettingsStore.getState();

const publishAppSettings = (settings: AppSettings): void =>
  appSettingsStore.setState(settings, true);

/** Hydrates renderer state from the single app-start reply. */
export const hydrateAppSettingsState = (settings: AppSettings): void => {
  updateVersion += 1;
  publishAppSettings(settings);
};

export const updateAppSettingsState = async (
  appSettingsApi: AppSettingsApi | undefined,
  patch: Partial<AppSettings>
): Promise<void> => {
  const previous = getAppSettingsState();
  const next = { ...previous, ...patch };
  const version = updateVersion + 1;
  updateVersion = version;
  publishAppSettings(next);

  if (appSettingsApi === undefined) {
    return;
  }

  try {
    const reply = await appSettingsApi.set(next);
    if (version === updateVersion) {
      publishAppSettings(reply.ok ? reply.data : previous);
    }
  } catch {
    if (version === updateVersion) {
      publishAppSettings(previous);
    }
  }
};

export const useAppSettings = (
  appSettingsApi: AppSettingsApi | undefined
): UseAppSettings => {
  const settings = useStore(appSettingsStore);

  const update = useCallback(
    (patch: Partial<AppSettings>) => {
      void updateAppSettingsState(appSettingsApi, patch);
    },
    [appSettingsApi]
  );

  return {
    ...settings,
    setAnimationsEnabled: (animationsEnabled) => {
      update({ animationsEnabled });
    },
    setLaunchAtLogin: (launchAtLogin) => {
      update({ launchAtLogin });
    },
    setOpenThreadsInNewWindows: (openThreadsInNewWindows) => {
      update({ openThreadsInNewWindows });
    },
    setRunInBackground: (runInBackground) => {
      update({ runInBackground });
    },
  };
};

export const useAnimationsEnabled = (): boolean =>
  useStore(appSettingsStore, (settings) => settings.animationsEnabled);

export const useOpenThreadsInNewWindows = (): boolean =>
  useStore(appSettingsStore, (settings) => settings.openThreadsInNewWindows);
