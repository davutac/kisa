import type { ReactNode } from "react";
import { createContext, use } from "react";

import type { GoogleAccount } from "@/shared/ipc/auth";

const GoogleAccountsContext = createContext<readonly GoogleAccount[]>([]);
const ReorderGoogleAccountsContext = createContext<
  (accounts: readonly GoogleAccount[]) => Promise<void>
>(() => Promise.resolve());

export const GoogleAccountsProvider = ({
  accounts,
  children,
  onReorder,
}: {
  accounts: readonly GoogleAccount[];
  children: ReactNode;
  onReorder: (accounts: readonly GoogleAccount[]) => Promise<void>;
}) => (
  <GoogleAccountsContext value={accounts}>
    <ReorderGoogleAccountsContext value={onReorder}>
      {children}
    </ReorderGoogleAccountsContext>
  </GoogleAccountsContext>
);

export const useGoogleAccounts = (): readonly GoogleAccount[] =>
  use(GoogleAccountsContext);

export const useGoogleAccount = (
  accountId: string
): GoogleAccount | undefined =>
  useGoogleAccounts().find(({ email }) => email === accountId);

export const useReorderGoogleAccounts = (): ((
  accounts: readonly GoogleAccount[]
) => Promise<void>) => use(ReorderGoogleAccountsContext);
