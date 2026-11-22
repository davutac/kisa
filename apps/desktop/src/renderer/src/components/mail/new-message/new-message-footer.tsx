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
import type { ComponentProps, ReactNode } from "react";

import { SendWithScheduleMenu } from "@/components/mail/schedule-send-menu";
import { Button } from "@/components/ui/button";
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
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { formatScheduledAt, LOCAL_TIME_ZONE } from "@/scheduled/schedule-time";

import {
  getComposerDeliveryLabel,
  submitNewMessageDelivery,
} from "./new-message-delivery";
import type { NewMessageLayout } from "./new-message-layout";

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

/** The chosen send time beside Send in the titlebar, where a strip has no room. */
const SelectedDeliveryTimeChip = ({
  label = "Selected send time",
  onRemove,
  scheduledAt,
}: SelectedDeliveryTimeProps) => {
  if (scheduledAt === undefined) {
    return null;
  }
  const formatted = formatScheduledAt(scheduledAt);

  return (
    <div
      aria-label={label}
      className="bg-muted/50 text-muted-foreground flex h-7 items-center gap-1.5 rounded-md pr-0.5 pl-2 text-xs"
    >
      <CalendarClockIcon className="size-3.5" />
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
        className={quietDestructiveClassName}
        disabled={disabled}
        onClick={() => {
          void onDiscard();
        }}
        size="footer-icon"
        title={`Discard scheduled email (${discardDisplay.bindings[0]})`}
        type="button"
        variant="secondary"
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

/**
 * A full-width strip of actions in the dialog. On the page the actions sit
 * in the content titlebar: compact buttons in one row, with the chosen send
 * time as a chip beside Send rather than a strip above it.
 */
const FOOTER_LAYOUT = {
  dialog: {
    actionsClassName: "bg-background flex shrink-0 items-stretch gap-px",
    DeliveryTime: SelectedDeliveryTime,
    primaryClassName: primaryFooterActionClassName,
    primarySize: "footer",
    stashClassName: undefined,
    stashSize: "footer-icon",
    stashVariant: "secondary",
  },
  page: {
    actionsClassName: "flex shrink-0 items-center gap-1",
    DeliveryTime: SelectedDeliveryTimeChip,
    primaryClassName: cn(primaryFooterActionClassName, "rounded-r-none px-2.5"),
    primarySize: "default",
    stashClassName: "text-muted-foreground hover:text-foreground",
    stashSize: "icon",
    stashVariant: "ghost",
  },
} as const satisfies Record<
  NewMessageLayout,
  {
    readonly actionsClassName: string;
    readonly DeliveryTime: (props: SelectedDeliveryTimeProps) => ReactNode;
    readonly primaryClassName: string;
    readonly primarySize: ComponentProps<typeof Button>["size"];
    readonly stashClassName: string | undefined;
    readonly stashSize: ComponentProps<typeof Button>["size"];
    readonly stashVariant: ComponentProps<typeof Button>["variant"];
  }
>;

interface NewMessageFooterProps {
  readonly canSend: boolean;
  readonly canStash: boolean;
  readonly isScheduling: boolean;
  readonly isSending: boolean;
  readonly layout: NewMessageLayout;
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
  isScheduling,
  isSending,
  layout,
  onSend,
  onStash,
  scheduled,
  sendShortcutLabel,
  stashPicker,
}: NewMessageFooterProps) => {
  const footerLayout = FOOTER_LAYOUT[layout];
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
    "composer.discard",
    () => {
      void handleDiscardSchedule();
    },
    { enabled: isEdit && !isBusy }
  );

  const primaryIcon = isScheduleSelected ? <CalendarClockIcon /> : <SendIcon />;
  const deliveryTime = (
    <footerLayout.DeliveryTime
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
      className={footerLayout.primaryClassName}
      disabled={isBusy || (isScheduleSelected ? !canSchedule : !canSend)}
      onClick={() => {
        void handlePrimaryAction();
      }}
      ref={primaryActionRef}
      size={footerLayout.primarySize}
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
    <>
      {layout === "dialog" ? deliveryTime : null}
      <div className={footerLayout.actionsClassName}>
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
            className={footerLayout.stashClassName}
            disabled={!canStash}
            onClick={onStash}
            onMouseDown={(event) => event.preventDefault()}
            size={footerLayout.stashSize}
            title="Stash draft"
            type="button"
            variant={footerLayout.stashVariant}
          >
            <ArchiveIcon />
          </Button>
        )}
        {isEdit ? null : stashPicker}
        {layout === "page" ? deliveryTime : null}
        <SendWithScheduleMenu
          compact={layout === "page"}
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
