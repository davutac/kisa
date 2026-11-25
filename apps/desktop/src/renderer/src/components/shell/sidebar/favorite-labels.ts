import { create } from "zustand";

import { normalizeMailboxLabelName } from "@/mail/mailbox-labels";

import { isMailboxCurrent } from "../shell-navigation";
import type { MailboxTarget, MailboxView } from "../shell-navigation";
import { readFavoriteLabels } from "./sidebar-preferences";
import type { FavoriteLabel } from "./sidebar-preferences";

export type { FavoriteLabel } from "./sidebar-preferences";

/** Favorites name one account's label, matched without regard to case. */
export const isSameFavoriteLabel = (
  left: FavoriteLabel,
  right: FavoriteLabel
): boolean =>
  left.accountId === right.accountId &&
  normalizeMailboxLabelName(left.label) ===
    normalizeMailboxLabelName(right.label);

export const toFavoriteTarget = ({
  accountId,
  label,
}: FavoriteLabel): MailboxTarget => ({ accountId, mailbox: { label } });

/** Adds a label to the end of the favorites, or takes it out. */
export const toggleFavoriteLabel = (
  favorites: readonly FavoriteLabel[],
  favorite: FavoriteLabel
): readonly FavoriteLabel[] =>
  favorites.some((candidate) => isSameFavoriteLabel(candidate, favorite))
    ? favorites.filter((candidate) => !isSameFavoriteLabel(candidate, favorite))
    : [...favorites, favorite];

/**
 * Whether a favorite shows the place on screen. The account tree then leaves
 * the current state to the favorite, so only one row reads as current.
 */
export const isHeldByFavorite = (
  view: MailboxView,
  favorites: readonly FavoriteLabel[]
): boolean =>
  favorites.some((favorite) =>
    isMailboxCurrent(view, toFavoriteTarget(favorite))
  );

interface FavoriteLabelsState {
  /**
   * Every favorite read or added this session. Storage keeps only connected
   * accounts' favorites, written by the sidebar whenever accounts change.
   */
  readonly favorites: readonly FavoriteLabel[];
  readonly toggleFavorite: (favorite: FavoriteLabel) => void;
}

export const useFavoriteLabelsStore = create<FavoriteLabelsState>()((set) => ({
  favorites: readFavoriteLabels(),
  toggleFavorite: (favorite) => {
    set((state) => ({
      favorites: toggleFavoriteLabel(state.favorites, favorite),
    }));
  },
}));

export const useIsFavoriteLabel = (favorite: FavoriteLabel): boolean =>
  useFavoriteLabelsStore((state) =>
    state.favorites.some((candidate) =>
      isSameFavoriteLabel(candidate, favorite)
    )
  );

export const useIsHeldByFavorite = (view: MailboxView): boolean =>
  useFavoriteLabelsStore((state) => isHeldByFavorite(view, state.favorites));
