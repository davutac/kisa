import { StarIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
            <Button
              aria-label={`Favorite ${favorite.label}`}
              aria-pressed={isFavorite}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/favorite:opacity-100 focus-visible:opacity-100"
              onClick={() => toggleFavorite(favorite)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <StarIcon className={cn(isFavorite && "fill-current")} />
            </Button>
          }
        />
        <TooltipContent side="right">{action}</TooltipContent>
      </Tooltip>
    </div>
  );
};

export default SidebarFavoriteToggle;
