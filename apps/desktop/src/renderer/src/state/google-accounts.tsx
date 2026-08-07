import type { ReactNode } from "react";
import { createContext, use } from "react";

import type { GoogleAccount } from "@/shared/ipc/auth";

const GoogleAccountsContext = createContext<readonly GoogleAccount[]>([]);

export const GoogleAccountsProvider = ({
  accounts,
  children,
}: {
  accounts: readonly GoogleAccount[];
  children: ReactNode;
}) => (
  <GoogleAccountsContext value={accounts}>{children}</GoogleAccountsContext>
);

export const useGoogleAccounts = (): readonly GoogleAccount[] =>
  use(GoogleAccountsContext);

export const useGoogleAccount = (
  accountId: string
): GoogleAccount | undefined =>
  useGoogleAccounts().find(({ email }) => email === accountId);
