import { PlusIcon, TagIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import type { MenuController } from "@/components/ui/menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import type { ThreadLabelChange } from "@/mail/use-thread-actions";
import type { MailLabelSummary } from "@/shared/ipc/mail";

interface ThreadLabelPickerProps {
  appliedLabels: readonly string[];
  controller: MenuController;
  isOpen: boolean;
  isLoading: boolean;
  labels: readonly MailLabelSummary[];
  onCreateLabel?: () => void;
  onOpenChange: (isOpen: boolean) => void;
  onSetLabel: (label: ThreadLabelChange) => void;
  pendingLabelIds: ReadonlySet<string>;
}

const ThreadLabelPicker = ({
  appliedLabels,
  controller,
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
    <Menu controller={controller} onOpenChange={onOpenChange} open={isOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
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
        {/* A tooltip around a menu trigger shares its name, so an agent's
            step by that name would match both. */}
        <TooltipContent
          className="flex items-center gap-2"
          data-agent-hidden
          side="bottom"
        >
          {display.label}
          <HotkeyHint command="thread.manageLabels" />
        </TooltipContent>
      </Tooltip>
      <MenuContent align="start" className="w-56">
        {labels.length === 0 ? (
          <MenuItem
            className="text-muted-foreground data-disabled:opacity-100"
            disabled
          >
            {isLoading
              ? "Consulting the label maker…"
              : "No labels. This thread travels light."}
          </MenuItem>
        ) : (
          labels.map((label) => {
            const applied = appliedLabels.includes(label.name);

            return (
              <MenuCheckboxItem
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
                value={label.id}
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
              </MenuCheckboxItem>
            );
          })
        )}
        {onCreateLabel === undefined ? null : (
          <>
            <MenuSeparator />
            <MenuItem onSelect={onCreateLabel}>
              <PlusIcon />
              Create new label
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
};

export default ThreadLabelPicker;
