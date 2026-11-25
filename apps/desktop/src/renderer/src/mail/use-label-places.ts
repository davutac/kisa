import { useCallback, useEffect, useMemo } from "react";

import { useLabelCatalogSnapshot } from "@/state/labels";
import { useMailbox, useMailboxStore } from "@/state/mailbox";

import { getScopeLabelItems, isMailboxLabelMissing } from "./mailbox-labels";
import type { MailboxLabelItem } from "./mailbox-labels";
import { isLabelPlace } from "./mailbox-place";
import { useMailboxAccountScope } from "./use-mailbox-account-scope";

/** The user labels of the accounts in a scope, merged by name. */
export const useScopeLabelItems = (
  accountIds: readonly string[]
): readonly MailboxLabelItem[] => {
  const { catalogs } = useLabelCatalogSnapshot();

  return useMemo(
    () => getScopeLabelItems(catalogs, accountIds),
    [accountIds, catalogs]
  );
};

/** Whether a label is known to be gone from every account of a scope. */
export const useIsLabelMissing = (): ((
  label: string,
  accountIds: readonly string[]
) => boolean) => {
  const { catalogs, statuses } = useLabelCatalogSnapshot();

  return useCallback(
    (label, accountIds) =>
      isMailboxLabelMissing(label, accountIds, catalogs, statuses),
    [catalogs, statuses]
  );
};

/**
 * A label place whose label was renamed or deleted, or that a scope switch
 * left in accounts without it, moves to the scope's Inbox. Owned by the shell
 * so it holds wherever the place is shown from.
 */
export const useLeaveMissingLabelPlace = (): void => {
  const mailbox = useMailbox();
  const { accountIds } = useMailboxAccountScope();
  const isLabelMissing = useIsLabelMissing();
  const setMailbox = useMailboxStore((state) => state.setMailbox);
  const isMissing =
    isLabelPlace(mailbox) && isLabelMissing(mailbox.label, accountIds);

  useEffect(() => {
    if (isMissing) {
      setMailbox("inbox");
    }
  }, [isMissing, setMailbox]);
};
