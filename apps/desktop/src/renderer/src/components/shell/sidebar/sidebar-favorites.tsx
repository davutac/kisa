import { TagIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import {
  isMailboxLabelMissing,
  normalizeMailboxLabelName,
} from "@/mail/mailbox-labels";
import { toUnreadLabelKey, useUnreadLabels } from "@/mail/use-unread-labels";
import { useAccounts } from "@/state/accounts";
import { useLabelCatalogSnapshot } from "@/state/labels";

import { isMailboxCurrent } from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { toFavoriteTarget, useFavoriteLabelsStore } from "./favorite-labels";
import SidebarFavoriteToggle, {
  favoriteToggleRowClassName,
} from "./sidebar-favorite-toggle";
import { writeFavoriteLabels } from "./sidebar-preferences";
import { SidebarRow, SidebarUnreadDot } from "./sidebar-row";

interface SidebarFavoritesProps {
  readonly onSelect: (target: MailboxTarget) => void;
  readonly view: MailboxView;
}

/**
 * Labels the user starred under an account, in the order they were added,
 * between search and the accounts; a favorite's own star takes it out. Each opens its account's label
 * place, as the row it came from does. A favorite of a disconnected account,
 * or one whose label its account no longer has, is not shown; nothing shows
 * until there is a favorite. A favorite whose place has unread conversations
 * shows the unread dot, as its label row does.
 */
const SidebarFavorites = ({ onSelect, view }: SidebarFavoritesProps) => {
  const accounts = useAccounts();
  const { catalogs, statuses } = useLabelCatalogSnapshot();
  const favorites = useFavoriteLabelsStore((state) => state.favorites);
  const accountIds = useMemo(
    () => accounts.map(({ email }) => email),
    [accounts]
  );

  // Rewritten when accounts change too, so a disconnected account's
  // favorites leave storage with the account.
  useEffect(() => {
    writeFavoriteLabels(favorites, accountIds);
  }, [accountIds, favorites]);

  const visible = favorites.filter(
    ({ accountId, label }) =>
      accountIds.includes(accountId) &&
      !isMailboxLabelMissing(label, [accountId], catalogs, statuses)
  );
  const unreadLabels = useUnreadLabels([
    ...new Set(visible.map(({ accountId }) => accountId)),
  ]);

  if (visible.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Favorites" className="flex flex-col gap-0.5">
      {visible.map((favorite) => {
        const target = toFavoriteTarget(favorite);
        const key = normalizeMailboxLabelName(favorite.label);
        const color = catalogs
          .get(favorite.accountId)
          ?.find(
            (candidate) =>
              candidate.type === "user" &&
              normalizeMailboxLabelName(candidate.name) === key
          )?.color;
        // The same label favorited in two accounts would read alike.
        const isNameShared = visible.some(
          (other) =>
            other.accountId !== favorite.accountId &&
            normalizeMailboxLabelName(other.label) === key
        );
        const isUnread = unreadLabels.has(
          toUnreadLabelKey(favorite.accountId, favorite.label)
        );

        return (
          <li key={`${favorite.accountId}\u0000${key}`}>
            <SidebarFavoriteToggle favorite={favorite}>
              <SidebarRow
                ariaLabel={`${favorite.label}, ${favorite.accountId}${isUnread ? ", unread messages" : ""}`}
                className={favoriteToggleRowClassName}
                icon={
                  <TagIcon
                    style={
                      color === undefined
                        ? undefined
                        : { color: color.background }
                    }
                  />
                }
                isCurrent={isMailboxCurrent(view, target)}
                label={favorite.label}
                onSelect={() => onSelect(target)}
                tooltipDetail={
                  <span className="opacity-70">{favorite.accountId}</span>
                }
                trailing={
                  isNameShared || isUnread ? (
                    <>
                      {isNameShared ? (
                        <span className="text-muted-foreground max-w-20 shrink-0 truncate text-[11px]">
                          {favorite.accountId}
                        </span>
                      ) : null}
                      {isUnread ? <SidebarUnreadDot /> : null}
                    </>
                  ) : undefined
                }
              />
            </SidebarFavoriteToggle>
          </li>
        );
      })}
    </ul>
  );
};

export default SidebarFavorites;
