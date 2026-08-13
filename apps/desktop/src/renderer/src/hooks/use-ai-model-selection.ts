import { useEffect, useState } from "react";

import { AI_PROVIDER_NAMES, getAiModelSelection } from "@/ai";
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
        const reply = await aiApi.getSettings();
        if (active && reply.ok) {
          setSelection(getAiModelSelection(reply.data));
        }
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
