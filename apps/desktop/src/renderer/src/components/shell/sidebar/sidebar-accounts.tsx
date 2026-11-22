import {
  Accessibility,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { HouseIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { OPEN_ACCOUNT_COMMAND_IDS } from "@/hotkeys";
import { getScopeLabelItems } from "@/mail/mailbox-labels";
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

// Dragging an account's icon is a pointer shortcut. The keyboard sensor and
// the accessibility plugin are left out: they would make the decorative icon
// a focusable "draggable" inside the row's button, and Enter or Space on it
// would start a drag instead of opening the account.
const accountDragSensors = [
  PointerSensor.configure({
    activationConstraints: [
      new PointerActivationConstraints.Distance({ value: 15 }),
    ],
  }),
];

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

  const handleAccountDrag = (event: DragEndEvent): void => {
    const { source } = event.operation;
    if (event.canceled || !isSortable(source)) {
      return;
    }
    const { index, initialIndex } = source;
    if (index === initialIndex) {
      return;
    }
    const reorderedAccounts = [...accounts];
    const [movedAccount] = reorderedAccounts.splice(initialIndex, 1);
    if (movedAccount === undefined) {
      return;
    }
    reorderedAccounts.splice(index, 0, movedAccount);
    void reorderAccounts(reorderedAccounts);
  };

  return (
    <ul aria-label="Accounts" className="flex flex-col gap-0.5">
      <li>
        {/* The combined Inbox only: Sent, Spam, Trash, and labels belong to
            each account. */}
        <SidebarRow
          command="app.openAllAccounts"
          icon={<HouseIcon />}
          isCurrent={isScopeRowCurrent(view, null, false)}
          label="All accounts"
          onSelect={onOpenAllAccounts}
        />
      </li>
      <DragDropProvider
        onDragEnd={handleAccountDrag}
        plugins={(defaults) =>
          defaults.filter((plugin) => plugin !== Accessibility)
        }
        sensors={accountDragSensors}
      >
        {accounts.map((account, index) => (
          <SidebarAccountRow
            account={account}
            command={OPEN_ACCOUNT_COMMAND_IDS[index]}
            index={index}
            isExpanded={expandedScopes.has(account.email)}
            isLabelsExpanded={expandedLabelScopes.has(account.email)}
            key={account.email}
            labels={getScopeLabelItems(catalogs, [account.email])}
            onExpandedChange={setScopeExpanded}
            onLabelsExpandedChange={setLabelsExpanded}
            onOpen={onOpenAccount}
            onSelectMailbox={onSelectMailbox}
            view={view}
          />
        ))}
      </DragDropProvider>
    </ul>
  );
};

export default SidebarAccounts;
