import { PlusIcon, TagIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
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
  onOpenChange: (isOpen: boolean) => void;
  onSetLabel: (label: ThreadLabelChange) => void;
  pendingLabelIds: ReadonlySet<string>;
}

const ThreadLabelPicker = ({
  appliedLabels,
  isOpen,
  isLoading,
  labels,
  onOpenChange,
  onSetLabel,
  pendingLabelIds,
}: ThreadLabelPickerProps) => {
  const display = getHotkeyDisplay("thread.manageLabels");

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={isOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            aria-keyshortcuts={getHotkeyAriaLabel("thread.manageLabels")}
            aria-label={display.label}
            className="rounded-full"
            size="icon-sm"
            title={`${display.label} (${display.bindings[0]})`}
            type="button"
            variant="secondary"
          />
        }
      >
        <PlusIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {labels.length === 0 ? (
          <DropdownMenuLabel>
            {isLoading ? "Loading labels…" : "No user labels"}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ThreadLabelPicker;
