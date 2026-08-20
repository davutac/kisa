import { useCallback, useEffect } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { LoginItemSettingsApi } from "@/platform/desktop";
import type { LoginItemSettings } from "@/shared/ipc/app";

const loginItemSettingsStore = createStore<LoginItemSettings | null>()(
  () => null
);
let requestVersion = 0;

export const getLoginItemSettingsState = (): LoginItemSettings | null =>
  loginItemSettingsStore.getState();

const publishLoginItemSettings = (settings: LoginItemSettings | null): void =>
  loginItemSettingsStore.setState(settings, true);

export const refreshLoginItemSettingsState = async (
  api?: Pick<LoginItemSettingsApi, "get">
): Promise<void> => {
  const version = requestVersion + 1;
  requestVersion = version;

  if (api === undefined) {
    publishLoginItemSettings(null);
    return;
  }

  try {
    const reply = await api.get();
    if (version === requestVersion) {
      publishLoginItemSettings(reply.ok ? reply.data : null);
    }
  } catch {
    if (version === requestVersion) {
      publishLoginItemSettings(null);
    }
  }
};

export const updateLoginItemSettingsState = async (
  api: Pick<LoginItemSettingsApi, "set"> | undefined,
  openAtLogin: boolean
): Promise<void> => {
  if (api === undefined) {
    return;
  }

  const previous = getLoginItemSettingsState();
  const version = requestVersion + 1;
  requestVersion = version;
  publishLoginItemSettings({ openAtLogin, requiresApproval: false });

  try {
    const reply = await api.set({ openAtLogin });
    if (version === requestVersion) {
      publishLoginItemSettings(reply.ok ? reply.data : previous);
    }
  } catch {
    if (version === requestVersion) {
      publishLoginItemSettings(previous);
    }
  }
};

export interface UseLoginItemSettings {
  readonly setOpenAtLogin: (openAtLogin: boolean) => void;
  readonly settings: LoginItemSettings | null;
}

export const useLoginItemSettings = (
  api: LoginItemSettingsApi | undefined
): UseLoginItemSettings => {
  const settings = useStore(loginItemSettingsStore);

  useEffect(() => {
    void refreshLoginItemSettingsState(api);
  }, [api]);

  const setOpenAtLogin = useCallback(
    (openAtLogin: boolean) => {
      void updateLoginItemSettingsState(api, openAtLogin);
    },
    [api]
  );

  return { setOpenAtLogin, settings };
};
