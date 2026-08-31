import {
  ArchiveIcon,
  CalendarClockIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { AnimatePresence, m, useReducedMotionConfig } from "motion/react";
import { useRef, useState } from "react";

import { SendWithScheduleMenu } from "@/components/mail/schedule-send-menu";
import { Button } from "@/components/ui/button";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { formatScheduledAt, LOCAL_TIME_ZONE } from "@/scheduled/schedule-time";

import {
  getComposerDeliveryLabel,
  submitNewMessageDelivery,
} from "./new-message-delivery";

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

export const SelectedDeliveryTime = ({
  label = "Selected send time",
  onRemove,
  scheduledAt,
}: SelectedDeliveryTimeProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const formatted =
    scheduledAt === undefined ? undefined : formatScheduledAt(scheduledAt);

  return (
    <AnimatePresence initial={false}>
      {scheduledAt === undefined || formatted === undefined ? null : (
        <m.div
          animate={{ height: "auto", opacity: 1 }}
          className="shrink-0 overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
          key="selected-delivery-time"
          transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.16)}
        >
          <div
            aria-label={label}
            className="bg-muted/30 text-muted-foreground flex h-8 items-center gap-2 px-4 text-xs"
          >
            <CalendarClockIcon className="size-3.5" />
            <span>Send at</span>
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
                className="ml-auto"
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
        </m.div>
      )}
    </AnimatePresence>
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
  const discardDisplay = getHotkeyDisplay("composer.discardScheduled");
  const saveDisplay = getHotkeyDisplay("composer.stash");

  return (
    <>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("composer.discardScheduled")}
        aria-label="Permanently discard scheduled email"
        disabled={disabled}
        onClick={() => {
          void onDiscard();
        }}
        size="footer-icon"
        title={`Discard scheduled email (${discardDisplay.bindings[0]})`}
        type="button"
        variant="destructive"
      >
        <Trash2Icon />
      </Button>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("composer.stash")}
        className="w-fit flex-none"
        disabled={disabled || !isDirty || !canSend}
        onClick={() => {
          void onSave();
        }}
        size="footer"
        title={`Save scheduled email (${saveDisplay.bindings[0]})`}
        type="button"
        variant="secondary"
      >
        <SaveIcon />
        Save
      </Button>
    </>
  );
};

interface NewMessageFooterProps {
  readonly canSend: boolean;
  readonly canStash: boolean;
  readonly isScheduling: boolean;
  readonly isSending: boolean;
  readonly onSend: () => Promise<void>;
  readonly onStash: () => void;
  readonly scheduled: ScheduledComposerControls;
  readonly sendShortcutLabel: string;
}

const NewMessageFooter = ({
  canSend,
  canStash,
  isScheduling,
  isSending,
  onSend,
  onStash,
  scheduled,
  sendShortcutLabel,
}: NewMessageFooterProps) => {
  const [selectedScheduledAt, setSelectedScheduledAt] = useState<
    number | undefined
  >();
  const [isScheduleMenuOpen, setIsScheduleMenuOpen] = useState(false);
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
        setIsScheduleMenuOpen(true);
      } else {
        void handlePrimaryAction();
      }
    },
    { enabled: canSchedule && !isBusy }
  );
  useAppCommand(
    "composer.discardScheduled",
    () => {
      void handleDiscardSchedule();
    },
    { enabled: isEdit && !isBusy }
  );

  const primaryIcon = isScheduleSelected ? <CalendarClockIcon /> : <SendIcon />;

  const primaryAction = (
    <Button
      aria-keyshortcuts={getHotkeyAriaLabel(
        isScheduleSelected ? "composer.schedule" : "composer.send"
      )}
      className="relative"
      disabled={isBusy || (isScheduleSelected ? !canSchedule : !canSend)}
      onClick={() => {
        void handlePrimaryAction();
      }}
      ref={primaryActionRef}
      size="footer"
      title={
        isScheduleSelected
          ? `${isEdit ? "Reschedule" : "Schedule"} for ${formatScheduledAt(selectedScheduledAt)} (${scheduleDisplay.bindings[0]})`
          : sendShortcutLabel
      }
      type="button"
      variant="secondary"
    >
      {primaryIcon}
      {primaryLabel}
      <HotkeyHint
        className="absolute right-4"
        command={isScheduleSelected ? "composer.schedule" : "composer.send"}
      />
    </Button>
  );

  return (
    <>
      <SelectedDeliveryTime
        label={deliveryTimeLabel}
        onRemove={isEdit ? undefined : handleRemoveSchedule}
        scheduledAt={displayedScheduledAt}
      />
      <div className="bg-background flex shrink-0 items-stretch gap-px">
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
            disabled={!canStash}
            onClick={onStash}
            onMouseDown={(event) => event.preventDefault()}
            size="footer-icon"
            title="Stash draft"
            type="button"
            variant="secondary"
          >
            <ArchiveIcon />
          </Button>
        )}
        <SendWithScheduleMenu
          disabled={isBusy || !canSchedule}
          onChoose={handleSelectSchedule}
          onOpenChange={setIsScheduleMenuOpen}
          open={isScheduleMenuOpen}
          selectedScheduledAt={selectedScheduledAt}
        >
          {primaryAction}
        </SendWithScheduleMenu>
      </div>
    </>
  );
};

export default NewMessageFooter;
