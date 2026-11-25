import { dateParts, isISODate, toISODate } from "@ui-sdk/core/date";
import { CalendarClockIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DatePicker,
  DatePickerContent,
  DatePickerInput,
  DatePickerTrigger,
} from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import type { MenuController } from "@/components/ui/menu";
import { TimeInput } from "@/components/ui/time-input";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import {
  formatScheduledAt,
  getInitialCustomSchedule,
  getSchedulePresets,
  LOCAL_TIME_ZONE,
  resolveLocalScheduleTime,
  toTimeInputValue,
} from "@/scheduled/schedule-time";

interface ScheduleSendMenuProps {
  readonly controller: MenuController;
  readonly disabled: boolean;
  readonly onChoose: (scheduledAt: number) => void;
  readonly selectedScheduledAt: number | undefined;
}

type CustomScheduleDialogProps = Pick<ScheduleSendMenuProps, "onChoose"> & {
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
};

const CustomScheduleDialog = ({
  onChoose,
  onOpenChange,
  open,
}: CustomScheduleDialogProps) => {
  // The dialog reads the clock once when it opens.
  const initial = useInstanceValue(() => {
    const now = new Date();

    return {
      scheduledAt: getInitialCustomSchedule(now),
      startOfToday: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    };
  });

  const [selectedDay, setSelectedDay] = useState<Date | undefined>(
    initial.scheduledAt
  );

  // `null` while the time is empty or partly typed.
  const [time, setTime] = useState<string | null>(() =>
    toTimeInputValue(initial.scheduledAt)
  );

  const [error, setError] = useState<string | undefined>();
  const timeInputRef = useRef<HTMLDivElement>(null);
  const dayChosenRef = useRef(false);
  const errorId = error === undefined ? undefined : "scheduled-send-time-error";

  const firstTimeSegment = (): HTMLElement | null =>
    timeInputRef.current?.querySelector<HTMLElement>(
      '[data-slot="time-input-segment"]:not([data-type="literal"])'
    ) ?? null;

  const submit = (): void => {
    const resolved = resolveLocalScheduleTime(selectedDay, time ?? "");

    if (!resolved.ok) {
      setError(resolved.error);

      return;
    }

    setError(undefined);
    onChoose(resolved.scheduledAt);
    onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-sm" initialFocus={firstTimeSegment}>
        {/* Enter in the time submits the form, as TimeInput does in any form. */}
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Pick date and time</DialogTitle>
            <DialogDescription>
              The email will use one fixed instant. Times are shown in{" "}
              {LOCAL_TIME_ZONE}.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="grid grid-cols-[minmax(0,1fr)_7rem] items-start gap-3">
            <Field invalid={error !== undefined}>
              <FieldLabel>Date</FieldLabel>
              <DatePicker
                min={toISODate(initial.startOfToday)}
                onOpenChange={(dateOpen) => {
                  if (dateOpen) {
                    dayChosenRef.current = false;
                  }
                }}
                onValueChange={(value, details) => {
                  const day = isISODate(value) ? dateParts(value) : undefined;
                  setError(undefined);
                  setSelectedDay(
                    day === undefined
                      ? undefined
                      : new Date(day.year, day.month - 1, day.day)
                  );
                  dayChosenRef.current = details.reason === "item-press";
                }}
                value={toISODate(selectedDay) ?? null}
              >
                <DatePickerInput aria-describedby={errorId} />
                <DatePickerTrigger />
                <DatePickerContent
                  finalFocus={() =>
                    dayChosenRef.current ? firstTimeSegment() : undefined
                  }
                />
              </DatePicker>
            </Field>
            <Field invalid={error !== undefined}>
              <FieldLabel>Time</FieldLabel>
              <TimeInput
                aria-describedby={errorId}
                onValueChange={(value) => {
                  setError(undefined);
                  setTime(value);
                }}
                ref={timeInputRef}
                value={time}
              />
            </Field>
            {error === undefined ? null : (
              <p
                className="text-destructive col-span-2 text-xs/relaxed"
                id="scheduled-send-time-error"
                role="alert"
              >
                {error}
              </p>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button type="submit">
              <CalendarClockIcon />
              Use this time
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ScheduleSendMenu = ({
  controller,
  disabled,
  onChoose,
  selectedScheduledAt,
}: ScheduleSendMenuProps) => {
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customOpenings, setCustomOpenings] = useState(0);
  const [presets, setPresets] = useState(() => getSchedulePresets(new Date()));

  const triggerLabel =
    selectedScheduledAt === undefined
      ? "Schedule send"
      : `Selected send time: ${formatScheduledAt(selectedScheduledAt)}`;

  const scheduleDisplay = getHotkeyDisplay("composer.schedule");

  return (
    <>
      <Menu
        controller={controller}
        onOpenChange={(nextOpen, details) => {
          // A disabled trigger refuses a press, not an agent's setOpen.
          if (nextOpen && disabled) {
            details.cancel();

            return;
          }

          if (nextOpen) {
            setPresets(getSchedulePresets(new Date()));
          }
        }}
      >
        <MenuTrigger
          disabled={disabled}
          render={
            <Button
              aria-keyshortcuts={
                selectedScheduledAt === undefined
                  ? getHotkeyAriaLabel("composer.schedule")
                  : undefined
              }
              aria-label={triggerLabel}
              className="rounded-l-none"
              size="icon"
              title={
                selectedScheduledAt === undefined
                  ? `${triggerLabel} (${scheduleDisplay.bindings[0]})`
                  : triggerLabel
              }
              type="button"
              variant="secondary"
            />
          }
        >
          <CalendarClockIcon />
        </MenuTrigger>
        <MenuContent align="end" className="w-64" side="top">
          <MenuGroup>
            <MenuGroupLabel>Schedule send</MenuGroupLabel>
            {presets.map((preset) => (
              <MenuItem
                key={preset.id}
                onSelect={() => {
                  onChoose(preset.scheduledAt);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{preset.label}</span>{" "}
                  <span className="text-muted-foreground">
                    {formatScheduledAt(preset.scheduledAt)}
                  </span>
                </span>
              </MenuItem>
            ))}
          </MenuGroup>
          <MenuSeparator />
          <MenuItem
            onSelect={() => {
              setCustomOpenings((count) => count + 1);
              setIsCustomOpen(true);
            }}
          >
            <CalendarClockIcon />
            Pick date &amp; time
          </MenuItem>
        </MenuContent>
      </Menu>
      {/* Kept mounted so it can animate out; a new key on each opening
          reads the clock again and starts from an empty form. */}
      <CustomScheduleDialog
        key={customOpenings}
        onChoose={onChoose}
        onOpenChange={setIsCustomOpen}
        open={isCustomOpen}
      />
    </>
  );
};

/** Send beside its schedule menu, as a split button sized to its content. */
export const SendWithScheduleMenu = ({
  children,
  ...menuProps
}: ScheduleSendMenuProps & {
  readonly children: ReactNode;
}) => (
  <fieldset
    aria-label="Send options"
    className="m-0 flex min-w-0 flex-none items-stretch gap-px border-0 p-0"
  >
    {children}
    <ScheduleSendMenu {...menuProps} />
  </fieldset>
);
