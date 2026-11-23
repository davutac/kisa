import { HouseIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { OPEN_ACCOUNT_COMMAND_IDS } from "@/hotkeys";
import { getScopeLabelItems } from "@/mail/mailbox-labels";
import { SortableList } from "@/primitives/sortable-list";
import { useAccounts, useReorderAccounts } from "@/state/accounts";
import { useLabelCatalogSnapshot } from "@/state/labels";

import { isScopeRowCurrent } from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import SidebarAccountRow from "./sidebar-account-row";
import {
  readExpandedLabelScopes,
  readExpandedScopes,
  writeExpandedLabelScopes,
  writeExpandedScopes,
} from "./sidebar-preferences";
import { SidebarRow } from "./sidebar-row";

interface SidebarAccountsProps {
  readonly onOpenAccount: (accountEmail: string) => void;
  readonly onOpenAllAccounts: () => void;
  readonly onSelectMailbox: (target: MailboxTarget) => void;
  readonly view: MailboxView;
}

const toggleScope = (
  scopes: ReadonlySet<string>,
  key: string,
  expanded: boolean
): ReadonlySet<string> => {
  const next = new Set(scopes);
  if (expanded) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
};

/**
 * All accounts, which opens the combined Inbox and nothing more, then each
 * account, disclosing its own Sent, Spam, Trash, and labels. Which accounts
 * and label lists are open is remembered across launches for the accounts
 * still connected.
 */
const SidebarAccounts = ({
  onOpenAccount,
  onOpenAllAccounts,
  onSelectMailbox,
  view,
}: SidebarAccountsProps) => {
  const accounts = useAccounts();
  const reorderAccounts = useReorderAccounts();
  const { catalogs } = useLabelCatalogSnapshot();
  const reorderHintId = useId();
  const [expandedScopes, setExpandedScopes] =
    useState<ReadonlySet<string>>(readExpandedScopes);
  const [expandedLabelScopes, setExpandedLabelScopes] = useState<
    ReadonlySet<string>
  >(readExpandedLabelScopes);
  const accountIds = useMemo(
    () => accounts.map(({ email }) => email),
    [accounts]
  );

  // Rewritten when accounts change too, so a disconnected account's address
  // leaves storage with the account.
  useEffect(() => {
    writeExpandedScopes(expandedScopes, accountIds);
  }, [accountIds, expandedScopes]);
  useEffect(() => {
    writeExpandedLabelScopes(expandedLabelScopes, accountIds);
  }, [accountIds, expandedLabelScopes]);
  const setScopeExpanded = (key: string, expanded: boolean): void => {
    setExpandedScopes((current) => toggleScope(current, key, expanded));
  };
  const setLabelsExpanded = (key: string, expanded: boolean): void => {
    setExpandedLabelScopes((current) => toggleScope(current, key, expanded));
  };

  const handleReorder = (order: readonly string[]): void => {
    const byEmail = new Map(
      accounts.map((account) => [account.email, account])
    );
    void reorderAccounts(order.flatMap((email) => byEmail.get(email) ?? []));
  };

  return (
    <>
      <SortableList
        aria-label="Accounts"
        className="flex flex-col gap-0.5"
        onValueChange={handleReorder}
        value={accountIds}
      >
        {({ order }) => (
          <>
            <li>
              {/* The combined Inbox only: Sent, Spam, Trash, and labels
                  belong to each account. */}
              <SidebarRow
                command="app.openAllAccounts"
                icon={<HouseIcon />}
                isCurrent={isScopeRowCurrent(view, null, false)}
                label="All accounts"
                onSelect={onOpenAllAccounts}
              />
            </li>
            {order.map((email) => {
              // Numbered by the dropped order, as `Mod+2`–`Mod+9` are,
              // never by where a move in progress has put the account.
              const index = accountIds.indexOf(email);
              const account = accounts[index];
              return account === undefined ? null : (
                <SidebarAccountRow
                  account={account}
                  command={OPEN_ACCOUNT_COMMAND_IDS[index]}
                  isExpanded={expandedScopes.has(email)}
                  isLabelsExpanded={expandedLabelScopes.has(email)}
                  key={email}
                  labels={getScopeLabelItems(catalogs, [email])}
                  onExpandedChange={setScopeExpanded}
                  onLabelsExpandedChange={setLabelsExpanded}
                  onOpen={onOpenAccount}
                  onSelectMailbox={onSelectMailbox}
                  reorderHintId={reorderHintId}
                  view={view}
                />
              );
            })}
          </>
        )}
      </SortableList>
      <span hidden id={reorderHintId}>
        Press Space to pick up the account, the arrow keys to move it, and Space
        again to drop it.
      </span>
    </>
  );
};

export default SidebarAccounts;
