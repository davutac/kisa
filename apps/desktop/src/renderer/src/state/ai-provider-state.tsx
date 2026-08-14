import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import { getAiApi } from "@/platform/desktop";
import type { AiApi } from "@/platform/desktop";
import type { AiProviderStatus, AiSettings } from "@/shared/ipc/ai";

interface AiProviderState {
  readonly isLoadingProviders: boolean;
  readonly isLoadingSettings: boolean;
  readonly providers: readonly AiProviderStatus[];
  readonly providersError: string | null;
  readonly settings: AiSettings | null;
  readonly settingsError: string | null;
  readonly initialize: () => Promise<void>;
  readonly loadSettings: () => Promise<void>;
  readonly refreshProviders: () => Promise<void>;
  readonly saveSettings: (settings: AiSettings) => Promise<string | null>;
}

export const createAiProviderStateStore = (aiApi: AiApi | undefined) => {
  let initialization: Promise<void> | null = null;
  let providerRefresh: Promise<void> | null = null;
  let settingsLoad: Promise<void> | null = null;
  let settingsSaveRequest = 0;

  return createStore<AiProviderState>()((set, get) => ({
    initialize: async () => {
      if (initialization === null) {
        initialization =
          aiApi === undefined
            ? Promise.resolve()
            : (async () => {
                await Promise.all([
                  get().loadSettings(),
                  get().refreshProviders(),
                ]);
              })();
      }

      await initialization;
    },
    isLoadingProviders: aiApi !== undefined,
    isLoadingSettings: aiApi !== undefined,
    loadSettings: async () => {
      if (aiApi === undefined) {
        return;
      }
      if (settingsLoad !== null) {
        await settingsLoad;
        return;
      }

      set({ isLoadingSettings: true, settingsError: null });
      const load = (async (): Promise<void> => {
        try {
          const reply = await aiApi.getSettings();
          set(
            reply.ok
              ? { settings: reply.data, settingsError: null }
              : { settingsError: reply.error }
          );
        } catch {
          set({ settingsError: "Could not load AI writing settings" });
        } finally {
          set({ isLoadingSettings: false });
        }
      })();
      settingsLoad = load;
      try {
        await load;
      } finally {
        if (settingsLoad === load) {
          settingsLoad = null;
        }
      }
    },
    providers: [],
    providersError: null,
    refreshProviders: async () => {
      if (aiApi === undefined) {
        return;
      }
      if (providerRefresh !== null) {
        await providerRefresh;
        return;
      }

      set({ isLoadingProviders: true, providersError: null });
      const refresh = (async (): Promise<void> => {
        try {
          const reply = await aiApi.listProviders();
          set(
            reply.ok
              ? {
                  providers: reply.data,
                  providersError: null,
                }
              : { providersError: reply.error }
          );
        } catch {
          set({ providersError: "Could not inspect installed AI providers" });
        } finally {
          set({ isLoadingProviders: false });
        }
      })();
      providerRefresh = refresh;
      try {
        await refresh;
      } finally {
        if (providerRefresh === refresh) {
          providerRefresh = null;
        }
      }
    },
    saveSettings: async (settings) => {
      if (aiApi === undefined) {
        return "AI writing is unavailable";
      }

      const request = settingsSaveRequest + 1;
      settingsSaveRequest = request;
      try {
        const reply = await aiApi.updateSettings(settings);
        if (request !== settingsSaveRequest) {
          return null;
        }
        if (!reply.ok) {
          return reply.error;
        }
        set({ settings: reply.data, settingsError: null });
        return null;
      } catch {
        return request === settingsSaveRequest
          ? "Could not save AI writing settings"
          : null;
      }
    },
    settings: null,
    settingsError: null,
  }));
};

type AiProviderStateStore = ReturnType<typeof createAiProviderStateStore>;

const AiProviderStateContext = createContext<AiProviderStateStore | null>(null);

export const AiProviderStateProvider = ({
  children,
}: {
  readonly children: ReactNode;
}) => {
  const store = useMemo(() => createAiProviderStateStore(getAiApi()), []);

  useEffect(() => {
    void store.getState().initialize();
  }, [store]);

  return (
    <AiProviderStateContext value={store}>{children}</AiProviderStateContext>
  );
};

export const useAiProviderState = <Value,>(
  selector: (state: AiProviderState) => Value
): Value => {
  const store = useContext(AiProviderStateContext);
  if (store === null) {
    throw new Error("AiProviderStateProvider is missing");
  }
  return useStore(store, selector);
};
