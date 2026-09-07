import { useState } from "react";
import { toast } from "sonner";

import type { AuthApi } from "@/platform/desktop";

export const useGoogleOAuthSetup = (
  authApi: Pick<AuthApi, "setupGoogleOAuthClient"> | undefined,
  onConfigured: () => void
) => {
  const [isSettingUp, setIsSettingUp] = useState(false);

  const setupGoogle = async (): Promise<boolean> => {
    if (authApi === undefined) {
      return false;
    }

    setIsSettingUp(true);
    try {
      const reply = await authApi.setupGoogleOAuthClient();
      if (!reply.ok) {
        toast.error(reply.error);
        return false;
      }
      if (reply.data) {
        onConfigured();
      }
      return reply.data;
    } catch {
      toast.error("Could not save Google setup");
      return false;
    } finally {
      setIsSettingUp(false);
    }
  };

  return { isSettingUp, setupGoogle };
};
