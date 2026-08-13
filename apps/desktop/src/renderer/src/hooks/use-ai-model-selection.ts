import { useEffect, useState } from "react";

import {
  AI_PROVIDER_NAMES,
  getAiModelSelection,
  getAvailableAiModelSelection,
} from "@/ai";
import type { AiApi } from "@/platform/desktop";
import type { AiModelSelection } from "@/shared/ipc/ai";

export const useAiModelSelection = (aiApi: AiApi | undefined) => {
  const [selection, setSelection] = useState<AiModelSelection | null>(null);
  const [isLoading, setIsLoading] = useState(aiApi !== undefined);

  useEffect(() => {
    if (aiApi === undefined) {
      return;
    }
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const settingsReply = await aiApi.getSettings();
        if (!active) {
          return;
        }
        if (!settingsReply.ok) {
          setSelection(null);
          return;
        }
        const configuredSelection = getAiModelSelection(settingsReply.data);
        if (configuredSelection === null) {
          setSelection(null);
          return;
        }
        const providersReply = await aiApi.listProviders();
        if (!active) {
          return;
        }
        setSelection(
          providersReply.ok
            ? getAvailableAiModelSelection(
                configuredSelection,
                providersReply.data
              )
            : null
        );
      } catch {
        if (active) {
          setSelection(null);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [aiApi]);

  let label = "Choose an AI provider in Settings";
  if (isLoading) {
    label = "Loading AI provider…";
  } else if (selection !== null) {
    label = `${AI_PROVIDER_NAMES[selection.provider]} · ${selection.model}`;
  }

  return { label, selection };
};
