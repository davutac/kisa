import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon, UserRoundIcon } from "lucide-react";
import { useId } from "react";

import { Spinner } from "@/components/ui/spinner";
import type { HotkeyCommandId } from "@/hotkeys";
import type { MailboxLabelItem } from "@/mail/mailbox-labels";
import { useHasUnreadMail } from "@/mail/use-has-unread-mail";
import { useAccountIndexProgress } from "@/mail/use-mail-index-progress";
import { useIsAccountSyncing } from "@/mail/use-mail-sync-state";
import type { Account } from "@/shared/ipc/accounts";
import { toMailIndexRatio } from "@/shared/mail-index-progress";

import {
  isScopeRowCurrent,
  resolveScopeRowSelection,
} from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { useIsHeldByFavorite } from "./favorite-labels";
import {
  SidebarDisclosureIndicator,
  SidebarRow,
  SidebarUnreadDot,
} from "./sidebar-row";
import { SidebarScopeMailboxes } from "./sidebar-scope-mailboxes";

interface SidebarAccountRowProps {
  readonly account: Account;
  readonly command?: HotkeyCommandId;
  readonly index: number;
  readonly isExpanded: boolean;
  readonly isLabelsExpanded: boolean;
  readonly labels: readonly MailboxLabelItem[];
  readonly onExpandedChange: (accountEmail: string, expanded: boolean) => void;
  readonly onLabelsExpandedChange: (
    accountEmail: string,
    expanded: boolean
  ) => void;
  readonly onOpen: (accountEmail: string) => void;
  readonly onSelectMailbox: (target: MailboxTarget) => void;
  readonly view: MailboxView;
}

/**
 * The account's glyph, the same size as every other sidebar row icon. While
 * the account syncs a spinner takes its place, and while it indexes a ring
 * fills with the indexed share, or spins while that share is unknown.
 */
const AccountStatusIcon = ({
  indexedRatio,
  isIndexing,
  isSyncing,
}: {
  readonly indexedRatio: number | undefined;
  readonly isIndexing: boolean;
  readonly isSyncing: boolean;
}) => {
  if (isSyncing) {
    return <Spinner />;
  }
  if (!isIndexing) {
    return <UserRoundIcon />;
  }
  return (
    <svg
      className={indexedRatio === undefined ? "animate-spin" : undefined}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="9" />
      <circle
        className="stroke-primary"
        cx="12"
        cy="12"
        pathLength={100}
        r="9"
        strokeDasharray={`${indexedRatio === undefined ? 25 : indexedRatio * 100} 100`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
};

const SidebarAccountRow = ({
  account,
  command,
  index,
  isExpanded,
  isLabelsExpanded,
  labels,
  onExpandedChange,
  onLabelsExpandedChange,
  onOpen,
  onSelectMailbox,
  view,
}: SidebarAccountRowProps) => {
  const mailboxesId = useId();
  const { handleRef, ref, targetRef } = useSortable({
    id: account.email,
    index,
  });
  const iconRef = (element: HTMLSpanElement | null): void => {
    handleRef(element);
    targetRef(element);
  };
  const hasUnreadMail = useHasUnreadMail(account.email);
  const isHeldByFavorite = useIsHeldByFavorite(view);
  const isSyncing = useIsAccountSyncing(account.email);
  const indexProgress = useAccountIndexProgress(account.email);
  const isIndexing = indexProgress?.status === "running";
  const indexedRatio = toMailIndexRatio(indexProgress);

  // The list item is the sortable DOM node, because sorting moves that node,
  // with its mailboxes, among its siblings. The icon is the drag handle, shown
  // as a grip while hovered, so a press on the rest of the row stays an
  // ordinary click. It is also the fixed-size collision target, so a long
  // address cannot block a neighbouring position.
  return (
    <li ref={ref}>
      <SidebarRow
        ariaBusy={isSyncing || isIndexing}
        ariaControls={isExpanded ? mailboxesId : undefined}
        ariaExpanded={isExpanded}
        ariaLabel={`${account.email}${hasUnreadMail ? ", unread email" : ""}`}
        command={command}
        icon={
          <span
            aria-hidden="true"
            className="group/account-handle grid size-4 shrink-0 cursor-grab place-items-center"
            ref={iconRef}
          >
            <span className="contents group-hover/account-handle:hidden">
              <AccountStatusIcon
                indexedRatio={indexedRatio}
                isIndexing={isIndexing}
                isSyncing={isSyncing}
              />
            </span>
            <GripVerticalIcon className="hidden group-hover/account-handle:block" />
          </span>
        }
        isCurrent={
          !isHeldByFavorite &&
          isScopeRowCurrent(view, account.email, isExpanded)
        }
        label={account.email}
        onSelect={() => {
          const next = resolveScopeRowSelection(
            view,
            account.email,
            isExpanded
          );
          onExpandedChange(account.email, next.isExpanded);
          if (next.opensInbox) {
            onOpen(account.email);
          }
        }}
        tooltipDetail={
          <>
            {account.displayName === undefined ? null : (
              <span className="opacity-70">{account.displayName}</span>
            )}
            {isIndexing ? (
              <span className="opacity-70">
                {indexedRatio === undefined
                  ? "Indexing mail"
                  : `Indexing mail — ${Math.round(indexedRatio * 100)}%`}
              </span>
            ) : null}
          </>
        }
        trailing={
          <>
            {hasUnreadMail ? <SidebarUnreadDot /> : null}
            <SidebarDisclosureIndicator isExpanded={isExpanded} />
          </>
        }
      />
      {isExpanded ? (
        <SidebarScopeMailboxes
          accountId={account.email}
          id={mailboxesId}
          isLabelsExpanded={isLabelsExpanded}
          labels={labels}
          onLabelsExpandedChange={(expanded) =>
            onLabelsExpandedChange(account.email, expanded)
          }
          onSelect={onSelectMailbox}
          scopeAccountIds={[account.email]}
          scopeLabel={account.email}
          view={view}
        />
      ) : null}
    </li>
  );
};

export default SidebarAccountRow;
