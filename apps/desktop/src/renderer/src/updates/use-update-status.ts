import { useEffect, useState } from "react";

import type { UpdateApi } from "@/platform/desktop";

type UpdateStatus = Awaited<ReturnType<UpdateApi["getStatus"]>>;

export const useUpdateStatus = (updateApi: UpdateApi): UpdateStatus => {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });

  useEffect(() => {
    let isMounted = true;

    const loadStatus = async (): Promise<void> => {
      const currentStatus = await updateApi.getStatus();

      if (isMounted) {
        setStatus(currentStatus);
      }
    };

    void loadStatus();
    const unsubscribe = updateApi.onStatusChange(setStatus);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [updateApi]);

  return status;
};
