import { StarIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useFavoriteLabelsStore, useIsFavoriteLabel } from "./favorite-labels";
import type { FavoriteLabel } from "./favorite-labels";

/** Makes room in a row for the star while the star shows. */
export const favoriteToggleRowClassName =
  "group-hover/favorite:pr-8 group-focus-within/favorite:pr-8";

/**
 * A sidebar row that opens an account's label, with a star at its trailing
 * edge that adds the label to the favorites above the accounts or takes it
 * out. The star shows while the row is hovered or the star has focus, and is
 * filled for a favorite. It is a button beside the row, never inside it, so
 * the row stays one control and the star is reachable by Tab.
 */
const SidebarFavoriteToggle = ({
  children,
  favorite,
}: {
  readonly children: ReactNode;
  readonly favorite: FavoriteLabel;
}) => {
  const isFavorite = useIsFavoriteLabel(favorite);

  const toggleFavorite = useFavoriteLabelsStore(
    (state) => state.toggleFavorite
  );

  const action = isFavorite ? "Remove from Favorites" : "Add to Favorites";

  return (
    <div className="group/favorite relative">
      {children}
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={`Favorite ${favorite.label}`}
              // Centered by margins, not a transform, so the buttons' press
              // effect adds to it instead of undoing it.
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-1.5 my-auto opacity-0 group-hover/favorite:opacity-100 focus-visible:opacity-100"
              onPressedChange={() => toggleFavorite(favorite)}
              pressed={isFavorite}
              pressedVariant="ghost"
              size="icon-sm"
            >
              <StarIcon className="group-data-pressed/button:fill-current" />
            </Toggle>
          }
        />
        <TooltipContent side="right">{action}</TooltipContent>
      </Tooltip>
    </div>
  );
};

export default SidebarFavoriteToggle;
