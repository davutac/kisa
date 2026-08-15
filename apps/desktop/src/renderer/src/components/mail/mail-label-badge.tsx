import { LoaderCircleIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { gmailLabelColorStyle } from "@/mail/label";
import type { GmailLabelColor } from "@/shared/ipc/mail";

export type MailLabelBadgeSize = "compact" | "default";

export interface MailLabelBadgeProps {
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly color?: GmailLabelColor;
  readonly disabled?: boolean;
  readonly isRemoving?: boolean;
  readonly label: string;
  readonly onClick?: () => void;
  readonly onClickAriaLabel?: string;
  readonly onRemove?: () => void;
  readonly removeAriaLabel?: string;
  readonly size?: MailLabelBadgeSize;
}

const MailLabelBadge = ({
  ariaLabel,
  className,
  color,
  disabled = false,
  isRemoving = false,
  label,
  onClick,
  onClickAriaLabel,
  onRemove,
  removeAriaLabel = `Remove ${label}`,
  size = "default",
}: MailLabelBadgeProps) => {
  const canRemove = onRemove !== undefined;

  return (
    <Badge
      aria-label={ariaLabel}
      className={cn(
        "bg-muted text-muted-foreground shrink-0",
        size === "compact"
          ? "h-4 max-w-28 px-1.5 text-[10px]"
          : "h-5 max-w-32 px-2 text-xs",
        onClick !== undefined && "cursor-pointer",
        canRemove && "gap-0 hover:pr-1",
        className
      )}
      style={gmailLabelColorStyle(color)}
      title={onClickAriaLabel ?? label}
      variant="secondary"
    >
      {onClick === undefined ? (
        <span className="min-w-0 truncate">{label}</span>
      ) : (
        <button
          aria-label={onClickAriaLabel}
          className="min-w-0 cursor-pointer truncate text-left focus-visible:underline focus-visible:outline-none"
          disabled={disabled}
          onClick={onClick}
          type="button"
        >
          {label}
        </button>
      )}
      {canRemove ? (
        <button
          aria-label={removeAriaLabel}
          className={cn(
            "pointer-events-none flex h-3 w-0 shrink-0 items-center justify-center overflow-hidden rounded-full opacity-0 transition-[width,margin,opacity] group-hover/badge:pointer-events-auto group-hover/badge:ml-0.5 group-hover/badge:w-3 group-hover/badge:opacity-100 focus-visible:pointer-events-auto focus-visible:ml-0.5 focus-visible:w-3 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-current focus-visible:outline-none",
            isRemoving && "pointer-events-auto ml-0.5 w-3 opacity-100"
          )}
          disabled={disabled || isRemoving}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          title={removeAriaLabel}
          type="button"
        >
          {isRemoving ? (
            <LoaderCircleIcon className="size-2.5 animate-spin" />
          ) : (
            <XIcon className="size-2.5" />
          )}
        </button>
      ) : null}
    </Badge>
  );
};

export default MailLabelBadge;
