import type { Account } from "@/shared/ipc/accounts";

export const getInitialComposerAccountId = (
  accounts: readonly Pick<Account, "email">[],
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
