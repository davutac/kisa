import { CircleAlertIcon, GripVerticalIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useId } from "react";

import AccountProviderIcon from "@/components/accounts/account-provider-icon";
import { Collapsible } from "@/components/ui/collapsible";
import { Progress, ProgressRing } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { HotkeyCommandId } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import type { MailboxLabelItem } from "@/mail/mailbox-labels";
import { useAccountIndexProgress } from "@/mail/use-mail-index-progress";
import { useIsAccountSyncing } from "@/mail/use-mail-sync-state";
import { useUnreadCounts } from "@/mail/use-unread-counts";
import {
  SortableListHandle,
  SortableListItem,
} from "@/primitives/sortable-list";
import type { Account, AccountProvider } from "@/shared/ipc/accounts";
import { toMailIndexRatio } from "@/shared/mail-index-progress";
import { useOpenThreadId } from "@/state/mailbox";

import {
  isScopeRowCurrent,
  resolveScopeRowSelection,
} from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { useIsHeldByFavorite } from "./favorite-labels";
import {
  SidebarDisclosureIndicator,
  SidebarDisclosurePanel,
  SidebarRow,
  SidebarCountBadge,
  withUnreadCount,
} from "./sidebar-row";
import { SidebarScopeMailboxes } from "./sidebar-scope-mailboxes";

interface SidebarAccountRowProps {
  readonly account: Account;
  readonly command?: HotkeyCommandId;
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
  // Where the account sits in the list, a move in progress included.
  readonly position: number;
  readonly reorderHintId: string;
  readonly view: MailboxView;
}

export type AccountRowStatus =
  | "idle"
  | "indexing"
  | "needs-sign-in"
  | "syncing";

/**
 * What the account row shows. Syncing wins, because each try to sign in
 * again is a sync; between tries, an account whose sign-in was refused says
 * so in place of its progress.
 */
export const getAccountRowStatus = ({
  indexStatus,
  isSyncing,
}: {
  readonly indexStatus: string | undefined;
  readonly isSyncing: boolean;
}): AccountRowStatus => {
  if (isSyncing) {
    return "syncing";
  }
  if (indexStatus === "paused") {
    return "needs-sign-in";
  }
  return indexStatus === "running" ? "indexing" : "idle";
};

/**
 * The account's provider logo, the same size as every other sidebar row icon. While
 * the account syncs a spinner takes its place, and while it indexes a ring
 * fills with the indexed share, or spins while that share is unknown.
 */
const AccountStatusIcon = ({
  indexedRatio,
  provider,
  status,
}: {
  readonly indexedRatio: number | undefined;
  readonly provider: AccountProvider;
  readonly status: AccountRowStatus;
}) => {
  if (status === "syncing") {
    return <Spinner />;
  }
  if (status === "needs-sign-in") {
    return <CircleAlertIcon className="text-destructive" />;
  }
  if (status !== "indexing") {
    return <AccountProviderIcon className="size-4" provider={provider} />;
  }
  return (
    // The row's tooltip reads out the share; hidden, so an agent naming the
    // account finds only its row.
    <Progress
      aria-hidden="true"
      aria-label="Indexing progress"
      max={1}
      value={indexedRatio ?? null}
    >
      <ProgressRing className="[--progress-ring-color:var(--primary)]" />
    </Progress>
  );
};

const SidebarAccountRow = ({
  account,
  command,
  isExpanded,
  isLabelsExpanded,
  labels,
  onExpandedChange,
  onLabelsExpandedChange,
  onOpen,
  onSelectMailbox,
  position,
  reorderHintId,
  view,
}: SidebarAccountRowProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const mailboxesId = useId();
  const { inbox: unreadCount } = useUnreadCounts([account.email]);
  const isHeldByFavorite = useIsHeldByFavorite(view);
  const openThreadId = useOpenThreadId();
  const isSyncing = useIsAccountSyncing(account.email);
  const indexProgress = useAccountIndexProgress(account.email);
  const status = getAccountRowStatus({
    indexStatus: indexProgress?.status,
    isSyncing,
  });
  const isIndexing = status === "indexing";
  const needsSignIn = status === "needs-sign-in";
  const indexedRatio = toMailIndexRatio(indexProgress);

  const select = (): void => {
    const next = resolveScopeRowSelection(
      view,
      account.email,
      isExpanded,
      openThreadId !== null
    );
    onExpandedChange(account.email, next.isExpanded);
    if (next.opensInbox) {
      onOpen(account.email);
    }
  };

  // The handle sits over the row's empty icon slot, since a button can't nest
  // in the row's; a mouse click on it opens the account as the row does.
  // A row slides only when its place in the order changes, and not while it
  // is the one dragged, which follows the pointer up and down only.
  return (
    <SortableListItem
      className="data-dragging:bg-sidebar relative data-dragging:z-10 data-dragging:[translate:0_var(--drag-y,0)] data-dragging:rounded-md"
      label={account.email}
      render={(props, { dragging }) => (
        <m.li
          {...props}
          layout={shouldReduceMotion || dragging ? false : "position"}
          layoutDependency={position}
          transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.2)}
        />
      )}
      value={account.email}
    >
      {/* A press on the row may open the Inbox as well as disclose, so it
          runs the row's own selection; an agent's setOpen only discloses.
          `contents` keeps the handle the row's sibling, for its peer styles. */}
      <Collapsible
        className="contents"
        onOpenChange={(open, details) => {
          if (details.reason === "trigger-press") {
            select();
          } else {
            onExpandedChange(account.email, open);
          }
        }}
        open={isExpanded}
      >
        <SortableListHandle
          aria-describedby={reorderHintId}
          aria-label={`Reorder ${account.email}`}
          className="peer/handle group/handle focus-visible:ring-ring/50 aria-pressed:ring-ring/50 absolute top-2 left-2 z-10 grid size-4 cursor-grab touch-none place-items-center rounded-sm outline-none focus-visible:ring-2 aria-pressed:ring-2 [&_svg:not([class*='size-'])]:size-4"
          onClick={(event) => {
            if (event.detail > 0) {
              select();
            }
          }}
        >
          <span className="contents group-hover/handle:hidden group-focus-visible/handle:hidden">
            <AccountStatusIcon
              indexedRatio={indexedRatio}
              provider={account.provider}
              status={status}
            />
          </span>
          <GripVerticalIcon
            aria-hidden="true"
            className="hidden group-hover/handle:block group-focus-visible/handle:block"
          />
        </SortableListHandle>
        <SidebarRow
          ariaBusy={isSyncing || isIndexing}
          ariaLabel={withUnreadCount(
            `${account.email}${needsSignIn ? ", cannot sign in" : ""}`,
            unreadCount
          )}
          className="peer-hover/handle:bg-sidebar-accent peer-hover/handle:text-sidebar-accent-foreground"
          command={command}
          icon={<span aria-hidden="true" className="size-4 shrink-0" />}
          isCurrent={
            !isHeldByFavorite &&
            isScopeRowCurrent(view, account.email, isExpanded)
          }
          disclosure
          label={account.email}
          tooltipDetail={
            <>
              {account.displayName === undefined ? null : (
                <span className="opacity-70">{account.displayName}</span>
              )}
              {needsSignIn ? (
                <span className="opacity-70">
                  Cannot sign in. See Settings.
                </span>
              ) : null}
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
              <SidebarCountBadge count={unreadCount} />
              <SidebarDisclosureIndicator isExpanded={isExpanded} />
            </>
          }
        />
        <SidebarDisclosurePanel>
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
        </SidebarDisclosurePanel>
      </Collapsible>
    </SortableListItem>
  );
};

export default SidebarAccountRow;
