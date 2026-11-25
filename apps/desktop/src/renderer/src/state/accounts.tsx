import type { ReactNode } from "react";
import { createContext, use } from "react";

import type { Account } from "@/shared/ipc/accounts";

const AccountsContext = createContext<readonly Account[]>([]);
const ReorderAccountsContext = createContext<
  (accounts: readonly Account[]) => Promise<void>
>(() => Promise.resolve());

export const AccountsProvider = ({
  accounts,
  children,
  onReorder,
}: {
  accounts: readonly Account[];
  children: ReactNode;
  onReorder: (accounts: readonly Account[]) => Promise<void>;
}) => (
  <AccountsContext value={accounts}>
    <ReorderAccountsContext value={onReorder}>
      {children}
    </ReorderAccountsContext>
  </AccountsContext>
);

export const useAccounts = (): readonly Account[] => use(AccountsContext);

export const useAccount = (accountId: string): Account | undefined =>
  useAccounts().find(({ email }) => email === accountId);

export const useReorderAccounts = (): ((
  accounts: readonly Account[]
) => Promise<void>) => use(ReorderAccountsContext);
