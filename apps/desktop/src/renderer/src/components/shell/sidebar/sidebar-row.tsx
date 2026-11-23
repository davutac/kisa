import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, HotkeyHint, isModHotkeyCommand } from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { cn } from "@/lib/utils";

// `aria-expanded:` resets undo the ghost button's filled, menu-open look, so
// an expanded account row reads like any other until it is current.
export const sidebarRowClassName =
  "aria-expanded:bg-transparent aria-expanded:text-sidebar-foreground/75 aria-expanded:hover:bg-sidebar-accent aria-expanded:hover:text-sidebar-accent-foreground aria-expanded:data-current:bg-sidebar-accent aria-expanded:data-current:text-sidebar-accent-foreground text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-current:bg-sidebar-accent data-current:text-sidebar-accent-foreground h-8 w-full justify-start gap-2.5 px-2 text-[13px] font-normal data-current:font-medium [&_svg:not([class*='size-'])]:size-4";

// A disclosure row is the trigger of the Collapsible around it, which opens
// and closes it, so it takes no `onSelect`.
type SidebarRowAction =
  | { readonly disclosure?: false; readonly onSelect: () => void }
  | { readonly disclosure: true; readonly onSelect?: undefined };

export type SidebarRowProps = SidebarRowAction & {
  readonly ariaBusy?: boolean;
  /** With `ariaExpanded`, the element holding what the row discloses. */
  readonly ariaControls?: string;
  readonly ariaExpanded?: boolean;
  /** Replaces the visible label for assistive technology, e.g. to add state. */
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly command?: HotkeyCommandId;
  readonly icon?: ReactNode;
  readonly isCurrent: boolean;
  readonly label: string;
  /** Extra tooltip lines under the label and its shortcut. */
  readonly tooltipDetail?: ReactNode;
  readonly trailing?: ReactNode;
};

/**
 * One sidebar destination. The tooltip carries the shortcut, so every row
 * teaches the same keyboard command it shares with the hotkey. While the
 * sidebar reveals hints for a held `Mod`, a `Mod` shortcut takes the
 * trailing slot instead, so a long address keeps its width.
 */
export const SidebarRow = ({
  ariaBusy,
  ariaControls,
  ariaExpanded,
  ariaLabel,
  className,
  command,
  disclosure,
  icon,
  isCurrent,
  label,
  onSelect,
  tooltipDetail,
  trailing,
}: SidebarRowProps) => {
  const rowProps = {
    "aria-busy": ariaBusy,
    "aria-current": isCurrent ? ("page" as const) : undefined,
    "aria-keyshortcuts":
      command === undefined ? undefined : getHotkeyAriaLabel(command),
    "aria-label": ariaLabel,
    className: cn(sidebarRowClassName, className),
    "data-current": isCurrent ? "" : undefined,
    variant: "ghost" as const,
  };
  const content = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {command === undefined || !isModHotkeyCommand(command) ? (
        trailing
      ) : (
        <>
          {trailing === undefined ? null : (
            <span className="contents in-data-[hotkey-hints]:hidden">
              {trailing}
            </span>
          )}
          <HotkeyHint
            className="hidden in-data-[hotkey-hints]:inline-flex motion-safe:transition-opacity motion-safe:starting:opacity-0"
            command={command}
          />
        </>
      )}
    </>
  );
  const button = disclosure ? (
    <CollapsibleTrigger {...rowProps}>{content}</CollapsibleTrigger>
  ) : (
    <Button
      {...rowProps}
      aria-controls={ariaControls}
      aria-expanded={ariaExpanded}
      onClick={onSelect}
      type="button"
    >
      {content}
    </Button>
  );

  if (command === undefined && tooltipDetail === undefined) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      {/* Around a disclosure, the closed tooltip would share the row's name
          with the bridge, so it hides from it, as on any popup trigger. */}
      <TooltipContent
        className="flex flex-col items-start gap-1"
        data-agent-hidden={disclosure ? true : undefined}
        side="right"
      >
        <span className="flex items-center gap-2">
          {label}
          {command === undefined ? null : <HotkeyHint command={command} />}
        </span>
        {tooltipDetail}
      </TooltipContent>
    </Tooltip>
  );
};

export const SidebarUnreadDot = ({ className }: { className?: string }) => (
  <span
    aria-hidden="true"
    className={cn("bg-destructive size-1.5 shrink-0 rounded-full", className)}
  />
);

/** The chevron a disclosing row shows; the row itself opens and closes. */
export const SidebarDisclosureIndicator = ({
  isExpanded,
}: {
  readonly isExpanded: boolean;
}) => (
  <ChevronRightIcon
    aria-hidden="true"
    className={cn(
      "text-muted-foreground size-3.5 shrink-0 transition-transform duration-150",
      isExpanded && "rotate-90"
    )}
  />
);
