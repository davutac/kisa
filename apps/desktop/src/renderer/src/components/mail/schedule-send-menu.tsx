import {
  CalendarClockIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  readonly disabled: boolean;
  readonly onChoose: (scheduledAt: number) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly selectedScheduledAt: number | undefined;
}

type CustomScheduleDialogProps = Pick<ScheduleSendMenuProps, "onChoose"> & {
  readonly onOpenChange: (open: boolean) => void;
};

const CustomScheduleDialog = ({
  onChoose,
  onOpenChange,
}: CustomScheduleDialogProps) => {
  const initial = useMemo(() => {
    const now = new Date();
    return {
      scheduledAt: getInitialCustomSchedule(now),
      startOfToday: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    };
  }, []);
  const [selectedDay, setSelectedDay] = useState<Date | undefined>(
    initial.scheduledAt
  );
  const [time, setTime] = useState(() => toTimeInputValue(initial.scheduledAt));
  const [error, setError] = useState<string | undefined>();
  const [isDateOpen, setIsDateOpen] = useState(false);
  const timeInputRef = useRef<HTMLInputElement>(null);
  const errorId = error === undefined ? undefined : "scheduled-send-time-error";

  const submit = (): void => {
    const resolved = resolveLocalScheduleTime(selectedDay, time);
    if (!resolved.ok) {
      setError(resolved.error);
      return;
    }
    setError(undefined);
    onChoose(resolved.scheduledAt);
    onOpenChange(false);
  };

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="sm:max-w-sm"
        initialFocus={timeInputRef}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
            submit();
          }
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
          <Field data-invalid={error === undefined ? undefined : true}>
            <FieldLabel htmlFor="scheduled-send-date">Date</FieldLabel>
            <Popover onOpenChange={setIsDateOpen} open={isDateOpen}>
              <PopoverTrigger
                render={
                  <Button
                    aria-describedby={errorId}
                    aria-invalid={error === undefined ? undefined : true}
                    className="w-full justify-start"
                    id="scheduled-send-date"
                    type="button"
                    variant="outline"
                  />
                }
              >
                <CalendarDaysIcon />
                <span className="truncate">
                  {selectedDay === undefined
                    ? "Choose date"
                    : selectedDay.toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                </span>
                <ChevronDownIcon className="text-muted-foreground ml-auto" />
              </PopoverTrigger>
              {isDateOpen ? (
                <PopoverContent align="start" className="w-auto gap-0 p-0">
                  <PopoverTitle className="sr-only">Delivery date</PopoverTitle>
                  <Calendar
                    disabled={{ before: initial.startOfToday }}
                    mode="single"
                    onSelect={(day) => {
                      setError(undefined);
                      setSelectedDay(day);
                      if (day !== undefined) {
                        setIsDateOpen(false);
                        queueMicrotask(() => timeInputRef.current?.focus());
                      }
                    }}
                    selected={selectedDay}
                  />
                </PopoverContent>
              ) : null}
            </Popover>
          </Field>
          <Field data-invalid={error === undefined ? undefined : true}>
            <FieldLabel htmlFor="scheduled-send-time">Time</FieldLabel>
            <Input
              aria-describedby={errorId}
              aria-invalid={error === undefined ? undefined : true}
              id="scheduled-send-time"
              onChange={(event) => {
                setError(undefined);
                setTime(event.currentTarget.value);
              }}
              ref={timeInputRef}
              step={60}
              type="time"
              value={time}
            />
          </Field>
          <FieldError className="col-span-2" id="scheduled-send-time-error">
            {error}
          </FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              submit();
            }}
            type="button"
          >
            <CalendarClockIcon />
            Use this time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const ScheduleSendMenu = ({
  disabled,
  onChoose,
  onOpenChange,
  open,
  selectedScheduledAt,
}: ScheduleSendMenuProps) => {
  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [presets, setPresets] = useState(() => getSchedulePresets(new Date()));
  const triggerLabel =
    selectedScheduledAt === undefined
      ? "Schedule send"
      : `Selected send time: ${formatScheduledAt(selectedScheduledAt)}`;
  const scheduleDisplay = getHotkeyDisplay("composer.schedule");
  let customDialog: ReactNode = null;
  if (isCustomOpen) {
    customDialog = (
      <CustomScheduleDialog
        onChoose={onChoose}
        onOpenChange={setIsCustomOpen}
      />
    );
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(nextOpen) => {
          onOpenChange(nextOpen);
          if (nextOpen) {
            setPresets(getSchedulePresets(new Date()));
          }
        }}
        open={open}
      >
        <DropdownMenuTrigger
          render={
            <Button
              aria-keyshortcuts={
                selectedScheduledAt === undefined
                  ? getHotkeyAriaLabel("composer.schedule")
                  : undefined
              }
              aria-label={triggerLabel}
              aria-pressed={
                selectedScheduledAt === undefined ? undefined : true
              }
              className="rounded-none!"
              disabled={disabled}
              size="footer-icon"
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
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64" side="top">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Schedule send</DropdownMenuLabel>
            {presets.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onClick={() => {
                  onChoose(preset.scheduledAt);
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span>{preset.label}</span>
                  <span className="text-muted-foreground">
                    {formatScheduledAt(preset.scheduledAt)}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => {
              setIsCustomOpen(true);
            }}
          >
            <CalendarClockIcon />
            Pick date &amp; time
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {customDialog}
    </>
  );
};

export const SendWithScheduleMenu = ({
  children,
  ...menuProps
}: ScheduleSendMenuProps & { readonly children: ReactNode }) => (
  <fieldset
    aria-label="Send options"
    className="m-0 flex min-w-0 flex-1 items-stretch gap-px border-0 p-0"
  >
    {children}
    <ScheduleSendMenu {...menuProps} />
  </fieldset>
);
