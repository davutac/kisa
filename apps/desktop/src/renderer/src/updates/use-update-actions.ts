import { useCallback } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import type { UpdateApi } from "@/platform/desktop";

export const useUpdateActions = (updateApi: UpdateApi) => {
  const confirm = useConfirm();

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

  return { downloadUpdate, installUpdate };
};
