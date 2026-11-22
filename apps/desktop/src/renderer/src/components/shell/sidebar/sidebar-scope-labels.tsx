import { TagIcon, TagsIcon } from "lucide-react";
import { useId } from "react";

import { cn } from "@/lib/utils";
import { toMailboxLabelRows } from "@/mail/mailbox-labels";
import type { MailboxLabelItem } from "@/mail/mailbox-labels";

import { isLabelsRowCurrent, isMailboxCurrent } from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { useIsHeldByFavorite } from "./favorite-labels";
import SidebarFavoriteToggle, {
  favoriteToggleRowClassName,
} from "./sidebar-favorite-toggle";
import { SidebarDisclosureIndicator, SidebarRow } from "./sidebar-row";

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

/**
 * An account's user labels, behind one Labels row that starts closed, so a
 * long label list never pushes the accounts below it out of reach. Each label
 * is a place like Sent: choosing it lists every conversation with it outside
 * Spam and Trash, and choosing it again returns to the account's Inbox.
 * Labels nest by their `/`-separated paths. An account without labels shows
 * no row. A label row's star adds it to the favorites, and the rows leave
 * the current state to a favorite that shows their place.
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
  const labelsId = useId();
  const isHeldByFavorite = useIsHeldByFavorite(view);

  if (labels.length === 0) {
    return null;
  }

  return (
    <li>
      <SidebarRow
        ariaControls={isExpanded ? labelsId : undefined}
        ariaExpanded={isExpanded}
        ariaLabel={`Labels, ${scopeLabel}`}
        className="pl-7"
        icon={<TagsIcon />}
        isCurrent={
          !isHeldByFavorite && isLabelsRowCurrent(view, accountId, isExpanded)
        }
        label="Labels"
        onSelect={() => onExpandedChange(!isExpanded)}
        trailing={<SidebarDisclosureIndicator isExpanded={isExpanded} />}
      />
      {isExpanded ? (
        <ul className="mt-0.5 flex flex-col gap-0.5" id={labelsId}>
          {toMailboxLabelRows(labels).map(({ depth, item, name }) => {
            const target = { accountId, mailbox: { label: item.name } };

            return (
              <li key={item.key}>
                <SidebarFavoriteToggle
                  favorite={{ accountId, label: item.name }}
                >
                  <SidebarRow
                    ariaLabel={`${item.name}, ${scopeLabel}`}
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
                    isCurrent={
                      !isHeldByFavorite && isMailboxCurrent(view, target)
                    }
                    label={name}
                    onSelect={() => onSelect(target)}
                    tooltipDetail={
                      name === item.name ? undefined : (
                        <span className="opacity-70">{item.name}</span>
                      )
                    }
                  />
                </SidebarFavoriteToggle>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
};

export default SidebarScopeLabels;
