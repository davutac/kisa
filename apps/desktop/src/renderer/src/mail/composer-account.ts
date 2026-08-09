import type { GoogleAccount } from "@/shared/ipc/auth";

export const getInitialComposerAccountId = (
  accounts: readonly Pick<GoogleAccount, "email">[],
  initialAccountId: string | null
): string => {
  if (
    initialAccountId !== null &&
    accounts.some(({ email }) => email === initialAccountId)
  ) {
    return initialAccountId;
  }

  return accounts.length === 1 ? (accounts[0]?.email ?? "") : "";
};
