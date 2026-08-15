import { useCallback, useEffect, useState } from "react";

import type { AppSettingsApi } from "@/platform/desktop";

export interface UseRunInBackground {
  /** Undefined while the persisted value is still loading. */
  readonly enabled: boolean | undefined;
  readonly toggle: (enabled: boolean) => void;
}

export const useRunInBackground = (
  appSettings: AppSettingsApi | undefined
): UseRunInBackground => {
  const [enabled, setEnabled] = useState<boolean | undefined>();

  useEffect(() => {
    if (appSettings === undefined) {
      return;
    }

    let cancelled = false;

    const load = async (): Promise<void> => {
      const reply = await appSettings.get();
      if (!cancelled && reply.ok) {
        setEnabled(reply.data.runInBackground);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [appSettings]);

  const toggle = useCallback(
    (next: boolean) => {
      if (appSettings === undefined) {
        return;
      }

      setEnabled(next);
      void (async () => {
        const reply = await appSettings.set({ runInBackground: next });
        if (reply.ok) {
          setEnabled(reply.data.runInBackground);
          return;
        }

        const reload = await appSettings.get();
        if (reload.ok) {
          setEnabled(reload.data.runInBackground);
        }
      })();
    },
    [appSettings]
  );

  return { enabled, toggle };
};
