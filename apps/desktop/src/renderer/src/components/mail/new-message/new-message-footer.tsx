import {
  ArchiveIcon,
  CalendarClockIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { SendWithScheduleMenu } from "@/components/mail/schedule-send-menu";
import { Button } from "@/components/ui/button";
import { createMenuController } from "@/components/ui/menu";
import { useInstanceValue } from "@/hooks/use-instance-value";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import {
  primaryFooterActionClassName,
  primaryFooterHintClassName,
  quietDestructiveClassName,
} from "@/lib/action-hierarchy";
import { cn } from "@/lib/utils";
import { formatScheduledAt, LOCAL_TIME_ZONE } from "@/scheduled/schedule-time";

import {
  describeComposerDelivery,
  getComposerDeliveryLabel,
  submitNewMessageDelivery,
} from "./new-message-delivery";
import type { ComposerDeliveryTarget } from "./new-message-delivery";

export interface ScheduledComposerControls {
  readonly canSchedule: boolean;
  readonly isDirty: boolean;
  readonly isEdit: boolean;
  readonly onDiscard: () => Promise<boolean>;
  readonly onPendingScheduleChange: (hasPendingSchedule: boolean) => void;
  readonly onSave: () => Promise<boolean>;
  readonly onSchedule: (scheduledAt: number) => Promise<boolean>;
  readonly scheduledAt: number | undefined;
}

interface SelectedDeliveryTimeProps {
  readonly label?: string;
  readonly onRemove?: () => void;
  readonly scheduledAt: number | undefined;
}

/** The chosen send time, as a chip beside Send in the titlebar. */
const SelectedDeliveryTime = ({
  label = "Selected send time",
  onRemove,
  scheduledAt,
}: SelectedDeliveryTimeProps) => {
  if (scheduledAt === undefined) {
    return null;
  }
  const formatted = formatScheduledAt(scheduledAt);

  return (
    <div className="bg-muted/50 text-muted-foreground flex h-7 items-center gap-1.5 rounded-md pr-0.5 pl-2 text-xs">
      <CalendarClockIcon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{label}:</span>
      <time
        className="text-foreground font-medium"
        dateTime={new Date(scheduledAt).toISOString()}
        title={`${formatted} (${LOCAL_TIME_ZONE})`}
      >
        {formatted}
      </time>
      {onRemove === undefined ? null : (
        <Button
          aria-label="Clear selected send time"
          onClick={onRemove}
          size="icon-xs"
          title="Clear selected send time"
          type="button"
          variant="ghost"
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
};

const ScheduledEditButtons = ({
  canSend,
  disabled,
  isDirty,
  onDiscard,
  onSave,
}: Pick<ScheduledComposerControls, "isDirty" | "onDiscard" | "onSave"> & {
  readonly canSend: boolean;
  readonly disabled: boolean;
}) => {
  const discardDisplay = getHotkeyDisplay("composer.discard");
  const saveDisplay = getHotkeyDisplay("composer.stash");

  return (
    <>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("composer.discard")}
        aria-label="Permanently discard scheduled email"
        className={cn("text-muted-foreground", quietDestructiveClassName)}
        disabled={disabled}
        onClick={() => {
          void onDiscard();
        }}
        size="icon"
        title={`Discard scheduled email (${discardDisplay.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <Trash2Icon />
      </Button>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("composer.stash")}
        className="text-muted-foreground hover:text-foreground"
        disabled={disabled || !isDirty || !canSend}
        onClick={() => {
          void onSave();
        }}
        title={`Save scheduled email (${saveDisplay.bindings[0]})`}
        type="button"
        variant="ghost"
      >
        <SaveIcon />
        Save
      </Button>
    </>
  );
};

// Each has a word "Schedule send" lacks, so an agent's step by it finds one
// control, and holds the button's visible text.
const PRIMARY_ACTION_NAMES = {
  Reschedule: "Reschedule email",
  Schedule: "Schedule email",
  Send: "Send email",
  "Send now": "Send now",
} as const;

interface NewMessageFooterProps {
  readonly canSend: boolean;
  readonly canStash: boolean;
  readonly delivery: ComposerDeliveryTarget;
  readonly isScheduling: boolean;
  readonly isSending: boolean;
  readonly onSend: () => Promise<void>;
  readonly onStash: () => void;
  readonly scheduled: ScheduledComposerControls;
  readonly sendShortcutLabel: string;
  /** The stash picker, placed between Stash and Send on the page. */
  readonly stashPicker?: ReactNode;
}

const NewMessageFooter = ({
  canSend,
  canStash,
  delivery,
  isScheduling,
  isSending,
  onSend,
  onStash,
  scheduled,
  sendShortcutLabel,
  stashPicker,
}: NewMessageFooterProps) => {
  const [selectedScheduledAt, setSelectedScheduledAt] = useState<
    number | undefined
  >();
  const scheduleMenu = useInstanceValue(createMenuController);
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const {
    canSchedule,
    isDirty,
    isEdit,
    onDiscard: handleDiscardSchedule,
    onPendingScheduleChange: handlePendingScheduleChange,
    onSave: handleSaveSchedule,
    onSchedule: handleSchedule,
    scheduledAt,
  } = scheduled;
  const isScheduleSelected = selectedScheduledAt !== undefined;
  const displayedScheduledAt = selectedScheduledAt ?? scheduledAt;
  const isBusy = isSending || isScheduling;
  const primaryLabel = getComposerDeliveryLabel(isEdit, selectedScheduledAt);
  const scheduleDisplay = getHotkeyDisplay("composer.schedule");
  let deliveryTimeLabel = "Selected send time";
  if (isEdit) {
    deliveryTimeLabel = isScheduleSelected
      ? "Selected reschedule time"
      : "Scheduled send time";
  }

  const handleSelectSchedule = (nextScheduledAt: number): void => {
    setSelectedScheduledAt(nextScheduledAt);
    if (isEdit) {
      handlePendingScheduleChange(true);
    }
  };
  const handleRemoveSchedule = (): void => {
    setSelectedScheduledAt(undefined);
    queueMicrotask(() => primaryActionRef.current?.focus());
  };
  const handlePrimaryAction = async (): Promise<void> => {
    const succeeded = await submitNewMessageDelivery(
      isScheduleSelected ? selectedScheduledAt : undefined,
      { schedule: handleSchedule, send: onSend }
    );
    if (isEdit && isScheduleSelected && succeeded === true) {
      setSelectedScheduledAt(undefined);
      handlePendingScheduleChange(false);
    }
  };

  useAppCommand(
    "composer.schedule",
    () => {
      if (selectedScheduledAt === undefined) {
        void scheduleMenu.open({ focus: "first" });
      } else {
        void handlePrimaryAction();
      }
    },
    { enabled: canSchedule && !isBusy }
  );
  useAppCommand(
    "composer.discard",
    () => {
      void handleDiscardSchedule();
    },
    { enabled: isEdit && !isBusy }
  );

  const primaryIcon = isScheduleSelected ? <CalendarClockIcon /> : <SendIcon />;
  const deliveryTime = (
    <SelectedDeliveryTime
      label={deliveryTimeLabel}
      onRemove={isEdit ? undefined : handleRemoveSchedule}
      scheduledAt={displayedScheduledAt}
    />
  );

  const primaryAction = (
    <Button
      aria-keyshortcuts={getHotkeyAriaLabel(
        isScheduleSelected ? "composer.schedule" : "composer.send"
      )}
      aria-label={PRIMARY_ACTION_NAMES[primaryLabel]}
      className={cn(primaryFooterActionClassName, "rounded-r-none px-2.5")}
      data-agent-confirm={describeComposerDelivery(
        isEdit,
        selectedScheduledAt,
        delivery
      )}
      disabled={isBusy || (isScheduleSelected ? !canSchedule : !canSend)}
      onClick={() => {
        void handlePrimaryAction();
      }}
      ref={primaryActionRef}
      title={
        isScheduleSelected
          ? `${isEdit ? "Reschedule" : "Schedule"} for ${formatScheduledAt(selectedScheduledAt)} (${scheduleDisplay.bindings[0]})`
          : sendShortcutLabel
      }
      type="button"
      variant="default"
    >
      {primaryIcon}
      {primaryLabel}
      <HotkeyHint
        className={cn("ml-2", primaryFooterHintClassName)}
        command={isScheduleSelected ? "composer.schedule" : "composer.send"}
      />
    </Button>
  );

  return (
    <div className="flex shrink-0 items-center gap-1">
      {isEdit ? (
        <ScheduledEditButtons
          canSend={canSend}
          disabled={isBusy}
          isDirty={isDirty}
          onDiscard={handleDiscardSchedule}
          onSave={handleSaveSchedule}
        />
      ) : (
        <Button
          aria-label="Stash draft"
          aria-keyshortcuts={getHotkeyAriaLabel("composer.stash")}
          className="text-muted-foreground hover:text-foreground"
          disabled={!canStash}
          onClick={onStash}
          onMouseDown={(event) => event.preventDefault()}
          size="icon"
          title="Stash draft"
          type="button"
          variant="ghost"
        >
          <ArchiveIcon />
        </Button>
      )}
      {isEdit ? null : stashPicker}
      {deliveryTime}
      <SendWithScheduleMenu
        controller={scheduleMenu}
        disabled={isBusy || !canSchedule}
        onChoose={handleSelectSchedule}
        selectedScheduledAt={selectedScheduledAt}
      >
        {primaryAction}
      </SendWithScheduleMenu>
    </div>
  );
};

export default NewMessageFooter;
