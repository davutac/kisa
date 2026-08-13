import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { AiApi } from "@/platform/desktop";
import type { AiProvider, AiProviderStatus, AiSettings } from "@/shared/ipc/ai";

import { areAiProviderModelsEqual } from "./ai-settings-view";

export const useAiSettings = (aiApi: AiApi) => {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [providers, setProviders] = useState<readonly AiProviderStatus[]>([]);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const settingsRequest = useRef(0);
  const providersRequest = useRef(0);
  const saveRequest = useRef(0);

  const loadSettings = useCallback(async (): Promise<void> => {
    const request = settingsRequest.current + 1;
    settingsRequest.current = request;
    setIsLoadingSettings(true);
    setSettingsError(null);
    try {
      const reply = await aiApi.getSettings();
      if (request !== settingsRequest.current) {
        return;
      }
      if (!reply.ok) {
        setSettingsError(reply.error);
        return;
      }
      setSettings(reply.data);
      setDraft(reply.data);
    } catch {
      if (request === settingsRequest.current) {
        setSettingsError("Could not load AI writing settings");
      }
    } finally {
      if (request === settingsRequest.current) {
        setIsLoadingSettings(false);
      }
    }
  }, [aiApi]);

  const refreshProviders = useCallback(async (): Promise<void> => {
    const request = providersRequest.current + 1;
    providersRequest.current = request;
    setIsLoadingProviders(true);
    setProvidersError(null);
    try {
      const reply = await aiApi.listProviders();
      if (request !== providersRequest.current) {
        return;
      }
      if (!reply.ok) {
        setProvidersError(reply.error);
        return;
      }
      setProviders(reply.data);
    } catch {
      if (request === providersRequest.current) {
        setProvidersError("Could not inspect installed AI providers");
      }
    } finally {
      if (request === providersRequest.current) {
        setIsLoadingProviders(false);
      }
    }
  }, [aiApi]);

  useEffect(() => {
    let active = true;
    const loadInitialSettings = async (): Promise<void> => {
      try {
        const reply = await aiApi.getSettings();
        if (!active) {
          return;
        }
        if (!reply.ok) {
          setSettingsError(reply.error);
          return;
        }
        setSettings(reply.data);
        setDraft(reply.data);
      } catch {
        if (active) {
          setSettingsError("Could not load AI writing settings");
        }
      } finally {
        if (active) {
          setIsLoadingSettings(false);
        }
      }
    };
    const loadInitialProviders = async (): Promise<void> => {
      try {
        const reply = await aiApi.listProviders();
        if (!active) {
          return;
        }
        if (!reply.ok) {
          setProvidersError(reply.error);
          return;
        }
        setProviders(reply.data);
      } catch {
        if (active) {
          setProvidersError("Could not inspect installed AI providers");
        }
      } finally {
        if (active) {
          setIsLoadingProviders(false);
        }
      }
    };

    void loadInitialSettings();
    void loadInitialProviders();
    return () => {
      active = false;
      settingsRequest.current += 1;
      providersRequest.current += 1;
    };
  }, [aiApi]);

  const setCleanupInstructions = (cleanupInstructions: string) => {
    setDraft((current) =>
      current === null ? null : { ...current, cleanupInstructions }
    );
  };

  const setReplyInstructions = (replyInstructions: string) => {
    setDraft((current) =>
      current === null ? null : { ...current, replyInstructions }
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
    settings !== null &&
    draft !== null &&
    (settings.activeProvider !== draft.activeProvider ||
      settings.cleanupInstructions !== draft.cleanupInstructions ||
      settings.replyInstructions !== draft.replyInstructions ||
      !areAiProviderModelsEqual(settings.providerModels, draft.providerModels));

  useEffect(() => {
    if (!isDirty || draft === null) {
      return;
    }
    const request = saveRequest.current + 1;
    saveRequest.current = request;
    void (async () => {
      try {
        const reply = await aiApi.updateSettings(draft);
        if (request !== saveRequest.current) {
          return;
        }
        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }
        setSettings(reply.data);
      } catch {
        if (request === saveRequest.current) {
          toast.error("Could not save AI writing settings");
        }
      }
    })();

    return () => {
      if (request === saveRequest.current) {
        saveRequest.current += 1;
      }
    };
  }, [aiApi, draft, isDirty]);

  return {
    draft,
    isLoadingProviders,
    isLoadingSettings,
    loadSettings,
    providers,
    providersError,
    refreshProviders,
    setActiveProvider,
    setCleanupInstructions,
    setProviderModel,
    setReplyInstructions,
    settings,
    settingsError,
  };
};
