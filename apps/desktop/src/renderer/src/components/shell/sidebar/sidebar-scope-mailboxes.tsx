import { SendIcon, ShieldAlertIcon, StarIcon, Trash2Icon } from "lucide-react";

import type { HotkeyCommandId } from "@/hotkeys";
import type { MailboxLabelItem } from "@/mail/mailbox-labels";
import { useUnreadCounts } from "@/mail/use-unread-counts";
import type { Mailbox } from "@/shared/ipc/mail";

import { isMailboxCurrent } from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { SidebarCountBadge, SidebarRow, withUnreadCount } from "./sidebar-row";
import type { SidebarRowProps } from "./sidebar-row";
import SidebarScopeLabels from "./sidebar-scope-labels";

interface ScopeMailbox {
  /** Starred has no shortcut; All accounts finds it with `is:starred`. */
  readonly command?: HotkeyCommandId;
  readonly icon: typeof SendIcon;
  readonly label: string;
  readonly mailbox: Mailbox;
}

// No Inbox row: the account row itself opens the scope's Inbox.
const SCOPE_MAILBOXES: readonly ScopeMailbox[] = [
  { icon: StarIcon, label: "Starred", mailbox: "starred" },
  { command: "app.toggleSent", icon: SendIcon, label: "Sent", mailbox: "sent" },
  {
    command: "app.toggleSpam",
    icon: ShieldAlertIcon,
    label: "Spam",
    mailbox: "spam",
  },
  {
    command: "app.toggleTrash",
    icon: Trash2Icon,
    label: "Trash",
    mailbox: "trash",
  },
];

/** Spam counts unread spam in the scope it opens. */
const SidebarSpamRow = ({
  accountIds,
  ...props
}: SidebarRowProps & { readonly accountIds: readonly string[] }) => {
  const { spam } = useUnreadCounts(accountIds);

  return (
    <SidebarRow
      {...props}
      ariaLabel={withUnreadCount(props.ariaLabel ?? props.label, spam)}
      trailing={spam === 0 ? undefined : <SidebarCountBadge count={spam} />}
    />
  );
};

interface SidebarScopeMailboxesProps {
  /** The account these rows open. */
  readonly accountId: string;
  readonly id: string;
  readonly isLabelsExpanded: boolean;
  /** The scope's user labels, merged across its accounts. */
  readonly labels: readonly MailboxLabelItem[];
  readonly onLabelsExpandedChange: (expanded: boolean) => void;
  readonly onSelect: (target: MailboxTarget) => void;
  /** The accounts the scope covers, for its unread Spam count. */
  readonly scopeAccountIds: readonly string[];
  readonly scopeLabel: string;
  readonly view: MailboxView;
}

/**
 * Starred, Sent, Spam, Trash, and the labels of one account, under the account row
 * that opens its Inbox. The mailbox shortcuts act on the current scope, so
 * their hints sit only on that account's rows.
 */
export const SidebarScopeMailboxes = ({
  accountId,
  id,
  isLabelsExpanded,
  labels,
  onLabelsExpandedChange,
  onSelect,
  scopeAccountIds,
  scopeLabel,
  view,
}: SidebarScopeMailboxesProps) => {
  const isCurrentScope = accountId === view.selectedAccountId;

  return (
    <ul className="flex flex-col gap-0.5" id={id}>
      {SCOPE_MAILBOXES.map(({ command, icon: Icon, label, mailbox }) => {
        const target = { accountId, mailbox };
        const rowProps: SidebarRowProps = {
          ariaLabel: `${label}, ${scopeLabel}`,
          className: "pl-7",
          command: isCurrentScope ? command : undefined,
          icon: <Icon />,
          isCurrent: isMailboxCurrent(view, target),
          label,
          onSelect: () => onSelect(target),
        };

        return (
          <li key={mailbox}>
            {mailbox === "spam" ? (
              <SidebarSpamRow accountIds={scopeAccountIds} {...rowProps} />
            ) : (
              <SidebarRow {...rowProps} />
            )}
          </li>
        );
      })}
      <SidebarScopeLabels
        accountId={accountId}
        isExpanded={isLabelsExpanded}
        labels={labels}
        onExpandedChange={onLabelsExpandedChange}
        onSelect={onSelect}
        scopeLabel={scopeLabel}
        view={view}
      />
    </ul>
  );
};
