import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type {
  AiProvider,
  AiProviderReasoning,
  AiSettings,
} from "@/shared/ipc/ai";
import { useAiProviderState } from "@/state/ai-provider-state";

import {
  areAiProviderModelsEqual,
  areAiProviderReasoningEqual,
  getReasoningAfterModelChange,
} from "./ai-settings-view";

const areAiSettingsEqual = (left: AiSettings, right: AiSettings): boolean =>
  left.activeProvider === right.activeProvider &&
  left.cleanupUserInstructions === right.cleanupUserInstructions &&
  left.replyUserInstructions === right.replyUserInstructions &&
  areAiProviderModelsEqual(left.providerModels, right.providerModels) &&
  areAiProviderReasoningEqual(left.providerReasoning, right.providerReasoning);

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
    setDraft((current) => {
      if (current === null) {
        return null;
      }
      const modelInfo = providers
        .find((status) => status.provider === provider)
        ?.models.find((candidate) => candidate.id === model);
      const currentReasoning = current.providerReasoning[provider];
      const nextReasoning = getReasoningAfterModelChange(
        currentReasoning,
        modelInfo
      );
      return {
        ...current,
        providerModels: { ...current.providerModels, [provider]: model },
        providerReasoning: {
          ...current.providerReasoning,
          [provider]: nextReasoning,
        },
      };
    });
  };

  const setProviderReasoning = <Provider extends AiProvider>(
    provider: Provider,
    reasoning: AiProviderReasoning[Provider]
  ) => {
    setDraft((current) =>
      current === null
        ? null
        : {
            ...current,
            providerReasoning: {
              ...current.providerReasoning,
              [provider]: reasoning,
            },
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
    setProviderReasoning,
    setReplyUserInstructions,
    settings,
    settingsError,
  };
};
