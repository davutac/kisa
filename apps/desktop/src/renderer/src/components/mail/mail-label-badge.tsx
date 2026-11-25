import { LoaderCircleIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { labelColorStyle } from "@/mail/label";
import type { MailLabelColor } from "@/shared/ipc/mail";

export type MailLabelBadgeSize = "compact" | "default";

export interface MailLabelBadgeProps {
  readonly className?: string;
  readonly color?: MailLabelColor;
  readonly disabled?: boolean;
  readonly isRemoving?: boolean;
  readonly label: string;
  readonly onClick?: () => void;
  readonly onClickAriaLabel?: string;
  readonly onRemove?: () => void;
  readonly removeAriaLabel?: string;
  readonly size?: MailLabelBadgeSize;
}

// The badge's own buttons only take Kisa's Button for its behavior; these
// classes undo its padding, height and focus ring to keep the badge's look.
const badgeButtonClassName =
  "h-auto min-w-0 gap-0 border-0 p-0 text-[length:inherit] leading-[inherit] hover:bg-transparent hover:text-current focus-visible:ring-0 active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-transparent";

const MailLabelBadge = ({
  className,
  color,
  disabled = false,
  isRemoving = false,
  label,
  onClick,
  onClickAriaLabel,
  onRemove,
  removeAriaLabel,
  size = "default",
}: MailLabelBadgeProps) => {
  const canRemove = onRemove !== undefined;
  const removeLabel = removeAriaLabel ?? `Remove ${label}`;

  return (
    <Badge
      className={cn(
        "bg-muted text-muted-foreground shrink-0",
        size === "compact"
          ? "h-4 max-w-28 px-1.5 text-[10px]"
          : "h-5 max-w-32 px-2 text-xs",
        onClick !== undefined && "cursor-pointer",
        canRemove && "gap-0 hover:pr-1",
        className
      )}
      style={labelColorStyle(color)}
      title={onClickAriaLabel ?? label}
      variant="secondary"
    >
      {onClick === undefined ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : (
        <Button
          aria-label={onClickAriaLabel}
          className={cn(
            badgeButtonClassName,
            "shrink cursor-pointer justify-start rounded-none text-left focus-visible:underline data-disabled:opacity-100"
          )}
          disabled={disabled}
          onClick={onClick}
          size="xs"
          type="button"
          variant="ghost"
        >
          <span className="truncate">{label}</span>
        </Button>
      )}
      {canRemove ? (
        <Button
          aria-label={removeLabel}
          className={cn(
            badgeButtonClassName,
            "pointer-events-none flex h-3 w-0 overflow-hidden rounded-full opacity-0 transition-[width,margin,opacity] group-hover/badge:pointer-events-auto group-hover/badge:ml-0.5 group-hover/badge:w-3 group-hover/badge:opacity-100 focus-visible:pointer-events-auto focus-visible:ml-0.5 focus-visible:w-3 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-current focus-visible:outline-none",
            isRemoving &&
              "pointer-events-auto ml-0.5 w-3 opacity-100 data-disabled:opacity-100"
          )}
          disabled={disabled || isRemoving}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          size="xs"
          title={removeLabel}
          type="button"
          variant="ghost"
        >
          {isRemoving ? (
            <LoaderCircleIcon className="size-2.5 animate-spin" />
          ) : (
            <XIcon className="size-2.5" />
          )}
        </Button>
      ) : null}
    </Badge>
  );
};

export default MailLabelBadge;
