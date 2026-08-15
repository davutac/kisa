import { PlusIcon, TagIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import type { GmailLabelSummary } from "@/shared/ipc/mail";

export interface ThreadLabelChange {
  readonly applied: boolean;
  readonly labelId: string;
  readonly labelName: string;
}

interface ThreadLabelPickerProps {
  appliedLabels: readonly string[];
  isOpen: boolean;
  isLoading: boolean;
  labels: readonly GmailLabelSummary[];
  onCreateLabel?: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onSetLabel: (label: ThreadLabelChange) => void;
  pendingLabelIds: ReadonlySet<string>;
}

const ThreadLabelPicker = ({
  appliedLabels,
  isOpen,
  isLoading,
  labels,
  onCreateLabel,
  onOpenChange,
  onSetLabel,
  pendingLabelIds,
}: ThreadLabelPickerProps) => {
  const display = getHotkeyDisplay("thread.manageLabels");

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={isOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  aria-keyshortcuts={getHotkeyAriaLabel("thread.manageLabels")}
                  aria-label={display.label}
                  className="rounded-full"
                  size="icon-sm"
                  type="button"
                  variant="secondary"
                >
                  <PlusIcon />
                </Button>
              }
            />
          }
        />
        <TooltipContent className="flex items-center gap-2" side="bottom">
          {display.label}
          <HotkeyHint command="thread.manageLabels" />
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-56">
        {labels.length === 0 ? (
          <DropdownMenuLabel>
            {isLoading
              ? "Consulting the label maker…"
              : "No labels. This thread travels light."}
          </DropdownMenuLabel>
        ) : (
          labels.map((label) => {
            const applied = appliedLabels.includes(label.name);

            return (
              <DropdownMenuCheckboxItem
                checked={applied}
                disabled={pendingLabelIds.has(label.id)}
                key={label.id}
                onCheckedChange={(checked) => {
                  onSetLabel({
                    applied: checked,
                    labelId: label.id,
                    labelName: label.name,
                  });
                }}
              >
                <TagIcon
                  aria-hidden="true"
                  className="text-muted-foreground fill-current"
                  style={
                    label.color === undefined
                      ? undefined
                      : { color: label.color.background }
                  }
                />
                <span className="min-w-0 truncate">{label.name}</span>
              </DropdownMenuCheckboxItem>
            );
          })
        )}
        {onCreateLabel === undefined ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCreateLabel}>
              <PlusIcon />
              Create new label
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ThreadLabelPicker;
