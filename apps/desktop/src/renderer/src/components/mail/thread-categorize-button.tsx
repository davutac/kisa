import { SparklesIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAiModelSelection } from "@/hooks/use-ai-model-selection";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { getAiApi } from "@/platform/desktop";

interface ThreadCategorizeButtonProps {
  accountId: string;
  threadId: string;
}

const ThreadCategorizeButton = ({
  accountId,
  threadId,
}: ThreadCategorizeButtonProps) => {
  const aiApi = getAiApi();
  const { isLoading, label: modelLabel, selection } = useAiModelSelection();
  const [isCategorizing, setIsCategorizing] = useState(false);

  if (aiApi === undefined) {
    return null;
  }

  const isDisabled = isLoading || selection === null || isCategorizing;
  let tooltip = modelLabel;
  if (selection !== null) {
    tooltip = isCategorizing
      ? "Categorizing…"
      : `Categorize with AI · ${modelLabel}`;
  }

  const categorize = async (): Promise<void> => {
    setIsCategorizing(true);
    await runWithCleanup(
      async () => {
        try {
          const reply = await aiApi.categorizeThread({ accountId, threadId });
          if (!reply.ok) {
            toast.error(reply.error);
            return;
          }

          const count = reply.data.labelIds.length;
          if (count === 0) {
            toast.info("No new labels added");
          } else {
            toast.success(`Added ${count} ${count === 1 ? "label" : "labels"}`);
          }
        } catch {
          toast.error("Could not categorize this conversation");
        }
      },
      () => {
        setIsCategorizing(false);
      }
    );
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-busy={isCategorizing}
            aria-label={
              selection === null
                ? `Categorize with AI unavailable: ${modelLabel}`
                : "Categorize with AI"
            }
            className="shrink-0 rounded-full"
            disabled={isDisabled}
            focusableWhenDisabled
            onClick={() => {
              void categorize();
            }}
            size="icon-sm"
            type="button"
            variant="ai"
          >
            {isCategorizing ? <Spinner aria-hidden="true" /> : <SparklesIcon />}
          </Button>
        }
      />
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
};

export default ThreadCategorizeButton;
