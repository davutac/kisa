import { TagIcon, TagsIcon } from "lucide-react";

import { Collapsible } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toMailboxLabelRows } from "@/mail/mailbox-labels";
import type { MailboxLabelItem } from "@/mail/mailbox-labels";
import {
  hasUnreadLabel,
  toUnreadLabelKey,
  useUnreadLabels,
} from "@/mail/use-unread-labels";

import { isLabelsRowCurrent, isMailboxCurrent } from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { useIsHeldByFavorite } from "./favorite-labels";
import SidebarFavoriteToggle, {
  favoriteToggleRowClassName,
} from "./sidebar-favorite-toggle";
import {
  SidebarDisclosureIndicator,
  SidebarDisclosurePanel,
  SidebarRow,
  SidebarUnreadDot,
} from "./sidebar-row";

// Static classes, so Tailwind sees each one. Labels sit one step in from the
// Labels row, and each nested level one step further, up to the last step.
const LABEL_DEPTH_CLASSES = [
  "pl-[2.625rem]",
  "pl-[3.5rem]",
  "pl-[4.375rem]",
  "pl-[5.25rem]",
] as const;

const getLabelDepthClass = (depth: number): string =>
  LABEL_DEPTH_CLASSES[Math.min(depth, LABEL_DEPTH_CLASSES.length - 1)] ??
  LABEL_DEPTH_CLASSES[0];

interface SidebarScopeLabelsProps {
  /** The account these rows open. */
  readonly accountId: string;
  readonly isExpanded: boolean;
  readonly labels: readonly MailboxLabelItem[];
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onSelect: (target: MailboxTarget) => void;
  readonly scopeLabel: string;
  readonly view: MailboxView;
}

interface SidebarScopeLabelListProps {
  readonly accountId: string;
  readonly isHeldByFavorite: boolean;
  readonly labels: readonly MailboxLabelItem[];
  readonly onSelect: (target: MailboxTarget) => void;
  readonly scopeLabel: string;
  readonly unreadLabels: ReadonlySet<string>;
  readonly view: MailboxView;
}

/** The open label list's rows, nested by path. */
const SidebarScopeLabelList = ({
  accountId,
  isHeldByFavorite,
  labels,
  onSelect,
  scopeLabel,
  unreadLabels,
  view,
}: SidebarScopeLabelListProps) => (
  <>
    {toMailboxLabelRows(labels).map(({ depth, item, name }) => {
      const target = { accountId, mailbox: { label: item.name } };
      const isUnread = unreadLabels.has(toUnreadLabelKey(accountId, item.name));

      return (
        <li key={item.key}>
          <SidebarFavoriteToggle favorite={{ accountId, label: item.name }}>
            <SidebarRow
              ariaLabel={`${item.name}, ${scopeLabel}${isUnread ? ", unread messages" : ""}`}
              className={cn(
                getLabelDepthClass(depth),
                favoriteToggleRowClassName
              )}
              icon={
                <TagIcon
                  style={
                    item.color === undefined
                      ? undefined
                      : { color: item.color.background }
                  }
                />
              }
              isCurrent={!isHeldByFavorite && isMailboxCurrent(view, target)}
              label={name}
              onSelect={() => onSelect(target)}
              tooltipDetail={
                name === item.name ? undefined : (
                  <span className="opacity-70">{item.name}</span>
                )
              }
              trailing={isUnread ? <SidebarUnreadDot /> : undefined}
            />
          </SidebarFavoriteToggle>
        </li>
      );
    })}
  </>
);

/**
 * An account's user labels, behind one Labels row that starts closed, so a
 * long label list never pushes the accounts below it out of reach. Each label
 * is a place like Sent: choosing it lists every conversation with it outside
 * Spam and Trash, and choosing it again returns to the account's Inbox.
 * Labels nest by their `/`-separated paths. An account without labels shows
 * no row. A label with unread conversations on its place shows the unread
 * dot, as Spam does, and while the labels are hidden the Labels row shows
 * it for any of them. A label row's star adds it to the favorites, and the
 * rows leave the current state to a favorite that shows their place.
 */
const SidebarScopeLabels = ({
  accountId,
  isExpanded,
  labels,
  onExpandedChange,
  onSelect,
  scopeLabel,
  view,
}: SidebarScopeLabelsProps) => {
  const isHeldByFavorite = useIsHeldByFavorite(view);
  const unreadLabels = useUnreadLabels(labels.length === 0 ? [] : [accountId]);
  // Open, each label carries its own dot; closed, the Labels row carries one
  // for them all, since none of them is in sight.
  const isUnreadHidden =
    !isExpanded && hasUnreadLabel(unreadLabels, accountId, labels);

  if (labels.length === 0) {
    return null;
  }

  return (
    <Collapsible
      onOpenChange={onExpandedChange}
      open={isExpanded}
      render={<li />}
    >
      <SidebarRow
        ariaLabel={`Labels, ${scopeLabel}${isUnreadHidden ? ", unread messages" : ""}`}
        className="pl-7"
        disclosure
        icon={<TagsIcon />}
        isCurrent={
          !isHeldByFavorite && isLabelsRowCurrent(view, accountId, isExpanded)
        }
        label="Labels"
        trailing={
          <>
            {isUnreadHidden ? <SidebarUnreadDot /> : null}
            <SidebarDisclosureIndicator isExpanded={isExpanded} />
          </>
        }
      />
      <SidebarDisclosurePanel>
        <ul className="flex flex-col gap-0.5">
          <SidebarScopeLabelList
            accountId={accountId}
            isHeldByFavorite={isHeldByFavorite}
            labels={labels}
            onSelect={onSelect}
            scopeLabel={scopeLabel}
            unreadLabels={unreadLabels}
            view={view}
          />
        </ul>
      </SidebarDisclosurePanel>
    </Collapsible>
  );
};

export default SidebarScopeLabels;
