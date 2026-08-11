import { useMemo } from "react";

import { useGoogleAccounts } from "@/state/google-accounts";
import { useSelectedAccountId } from "@/state/mailbox";

interface MailboxAccountScope {
  accountIds: readonly string[];
  selectedAccountId: string | null;
}

export const useMailboxAccountScope = (): MailboxAccountScope => {
  const accounts = useGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const knownAccountId = accounts.some(
    ({ email }) => email === selectedAccountId
  )
    ? selectedAccountId
    : null;
  const accountIds = useMemo(
    () =>
      knownAccountId === null
        ? accounts.map(({ email }) => email)
        : [knownAccountId],
    [accounts, knownAccountId]
  );

  return { accountIds, selectedAccountId: knownAccountId };
};
