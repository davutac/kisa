import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AiProvider, AiSettings } from "@/shared/ipc/ai";
import { useAiProviderState } from "@/state/ai-provider-state";

import { areAiProviderModelsEqual } from "./ai-settings-view";

const areAiSettingsEqual = (left: AiSettings, right: AiSettings): boolean =>
  left.activeProvider === right.activeProvider &&
  left.cleanupUserInstructions === right.cleanupUserInstructions &&
  left.replyUserInstructions === right.replyUserInstructions &&
  areAiProviderModelsEqual(left.providerModels, right.providerModels);

export const useAiSettings = () => {
  const isLoadingProviders = useAiProviderState(
    (state) => state.isLoadingProviders
  );
  const isLoadingSettings = useAiProviderState(
    (state) => state.isLoadingSettings
  );
  const loadSettings = useAiProviderState((state) => state.loadSettings);
  const providers = useAiProviderState((state) => state.providers);
  const providersError = useAiProviderState((state) => state.providersError);
  const refreshProviders = useAiProviderState(
    (state) => state.refreshProviders
  );
  const saveSettings = useAiProviderState((state) => state.saveSettings);
  const settings = useAiProviderState((state) => state.settings);
  const settingsError = useAiProviderState((state) => state.settingsError);
  const [draft, setDraft] = useState<AiSettings | null>(settings);
  const previousSettings = useRef(settings);

  useEffect(() => {
    if (settings === null) {
      return;
    }

    const previous = previousSettings.current;
    previousSettings.current = settings;
    setDraft((current) =>
      current === null ||
      (previous !== null && areAiSettingsEqual(current, previous))
        ? settings
        : current
    );
  }, [settings]);

  const setCleanupUserInstructions = (cleanupUserInstructions: string) => {
    setDraft((current) =>
      current === null ? null : { ...current, cleanupUserInstructions }
    );
  };

  const setReplyUserInstructions = (replyUserInstructions: string) => {
    setDraft((current) =>
      current === null ? null : { ...current, replyUserInstructions }
    );
  };

  const setActiveProvider = (activeProvider: AiProvider | null) => {
    setDraft((current) =>
      current === null ? null : { ...current, activeProvider }
    );
  };

  const setProviderModel = (provider: AiProvider, model: string) => {
    setDraft((current) =>
      current === null
        ? null
        : {
            ...current,
            providerModels: { ...current.providerModels, [provider]: model },
          }
    );
  };

  const isDirty =
    settings !== null && draft !== null && !areAiSettingsEqual(settings, draft);

  useEffect(() => {
    if (!isDirty || draft === null) {
      return;
    }

    let active = true;
    void (async () => {
      const error = await saveSettings(draft);
      if (active && error !== null) {
        toast.error(error);
      }
    })();

    return () => {
      active = false;
    };
  }, [draft, isDirty, saveSettings]);

  return {
    draft,
    isLoadingProviders,
    isLoadingSettings,
    loadSettings,
    providers,
    providersError,
    refreshProviders,
    setActiveProvider,
    setCleanupUserInstructions,
    setProviderModel,
    setReplyUserInstructions,
    settings,
    settingsError,
  };
};
