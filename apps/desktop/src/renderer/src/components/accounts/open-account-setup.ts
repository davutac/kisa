import { toast } from "sonner";

import { getAccountsApi } from "@/platform/desktop";

/**
 * Opens the Add account window, or focuses it when it is already open. The
 * window reports its own sign-in errors; the account list follows through
 * the accounts-changed subscription once main saves the account.
 */
export const openAccountSetup = async (): Promise<void> => {
  const reply = await getAccountsApi()?.openAccountSetup();

  if (reply?.ok === false) {
    toast.error(reply.error);
  }
};
