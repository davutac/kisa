import { useCallback, useState } from "react";

import { useConfirm } from "@/components/confirm-dialog";
import { toast } from "@/components/ui/toast";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import type { UpdateApi } from "@/platform/desktop";

import { getManualUpdateFeedback } from "./update-view";

const showManualUpdateFeedback = (
  feedback: ReturnType<typeof getManualUpdateFeedback>
): void => {
  if (feedback === null) {
    return;
  }

  toast[feedback.type](feedback.title, {
    description: feedback.description,
  });
};

export const useUpdateActions = (updateApi: UpdateApi) => {
  const confirm = useConfirm();
  const [isCheckPending, setIsCheckPending] = useState(false);

  /** A check the user asked for, so it reports its outcome either way. */
  const checkForUpdates = useCallback(async (): Promise<void> => {
    setIsCheckPending(true);

    await runWithCleanup(
      async () => {
        try {
          const nextStatus = await updateApi.check();
          showManualUpdateFeedback(getManualUpdateFeedback(nextStatus));
        } catch {
          toast.error("Could not check for updates", {
            description: "Please try again later.",
          });
        }
      },
      () => {
        setIsCheckPending(false);
      }
    );
  }, [updateApi]);

  const downloadUpdate = useCallback(async (): Promise<void> => {
    try {
      await updateApi.download();
    } catch {
      toast.error("Could not download the update", {
        description: "Please try again.",
      });
    }
  }, [updateApi]);

  const installUpdate = useCallback(
    async (version: string): Promise<void> => {
      const confirmed = await confirm({
        confirmLabel: "Install and Restart",
        description: `Kisa will close and restart to install version ${version}.`,
        title: "Install update now?",
      });

      if (!confirmed) {
        return;
      }

      try {
        await updateApi.install();
      } catch {
        toast.error("Could not install the update", {
          description: "Please try again.",
        });
      }
    },
    [confirm, updateApi]
  );

  return { checkForUpdates, downloadUpdate, installUpdate, isCheckPending };
};
