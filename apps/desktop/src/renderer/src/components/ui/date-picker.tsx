import {
  CalendarDay,
  CalendarGrid,
  CalendarHeading,
  CalendarNext,
  CalendarPrevious,
  CalendarWeekday,
  CalendarWeekdays,
  CalendarWeeks,
  DatePicker as DatePickerPrimitive,
  DatePickerContent as DatePickerContentPrimitive,
  DatePickerInput as DatePickerInputPrimitive,
  DatePickerTrigger as DatePickerTriggerPrimitive,
} from "@ui-sdk/react/date-picker";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ClassNameProps<Props> = Omit<Props, "className"> & { className?: string };

const stepClassName = cn(
  buttonVariants({ size: "icon", variant: "ghost" }),
  "size-(--cell-size) p-0 select-none"
);

// The root is the field's surface: the input and the calendar button share
// one ring, as an input group's do.
const DatePicker = ({
  className,
  onOpenChange,
  weekdayFormat = "narrow",
  ...props
}: ClassNameProps<React.ComponentProps<typeof DatePickerPrimitive>>) => (
  <DatePickerPrimitive
    className={cn(
      "bg-input/20 dark:bg-input/30 has-[[data-slot=date-picker-input]:focus-visible]:ring-ring/30 has-[[data-slot=date-picker-input][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-slot=date-picker-input][aria-invalid=true]]:ring-destructive/40 flex h-7 w-full min-w-0 items-center rounded-md border border-transparent pr-0.5 transition-colors has-[[data-slot=date-picker-input]:focus-visible]:ring-2 has-[[data-slot=date-picker-input][aria-invalid=true]]:ring-2 data-disabled:opacity-50",
      className
    )}
    // Like Kisa's Popover, the calendar stays open while another window has
    // focus.
    onOpenChange={(open, details) => {
      if (!open && details.reason === "window-blur") {
        details.cancel();
        return;
      }
      onOpenChange?.(open, details);
    }}
    weekdayFormat={weekdayFormat}
    {...props}
  />
);

const DatePickerInput = ({
  className,
  ...props
}: ClassNameProps<React.ComponentProps<typeof DatePickerInputPrimitive>>) => (
  <DatePickerInputPrimitive
    className={cn(
      "placeholder:text-muted-foreground h-full w-full min-w-0 flex-1 bg-transparent px-2 text-sm tabular-nums outline-none data-disabled:cursor-not-allowed md:text-xs/relaxed",
      className
    )}
    {...props}
  />
);

const DatePickerTrigger = ({
  className,
  ...props
}: ClassNameProps<
  Omit<React.ComponentProps<typeof DatePickerTriggerPrimitive>, "children">
>) => (
  <DatePickerTriggerPrimitive
    className={cn(
      buttonVariants({ size: "icon-sm", variant: "ghost" }),
      "text-muted-foreground size-6",
      className
    )}
    {...props}
  >
    <CalendarDaysIcon aria-hidden="true" />
  </DatePickerTriggerPrimitive>
);

const DatePickerContent = ({
  align = "start",
  className,
  sideOffset = 4,
  ...props
}: ClassNameProps<
  Omit<React.ComponentProps<typeof DatePickerContentPrimitive>, "children">
>) => (
  <DatePickerContentPrimitive
    align={align}
    className={cn(
      "bg-popover text-popover-foreground ring-foreground/10 flex w-fit origin-(--transform-origin) flex-col gap-2 rounded-lg p-3 text-xs shadow-md ring-1 outline-hidden transition-[opacity,scale] duration-100 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(6)] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
      className
    )}
    sideOffset={sideOffset}
    {...props}
  >
    <div className="flex h-(--cell-size) items-center justify-between gap-1">
      <CalendarPrevious className={stepClassName}>
        <ChevronLeftIcon aria-hidden="true" className="size-4 rtl:rotate-180" />
      </CalendarPrevious>
      <CalendarHeading className="text-sm font-medium select-none" />
      <CalendarNext className={stepClassName}>
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 rtl:rotate-180"
        />
      </CalendarNext>
    </div>
    <CalendarGrid className="border-separate border-spacing-x-0 border-spacing-y-1">
      <CalendarWeekdays>
        {(index) => (
          <CalendarWeekday
            className="text-muted-foreground size-(--cell-size) p-0 text-[0.8rem] font-normal select-none"
            index={index}
          />
        )}
      </CalendarWeekdays>
      <CalendarWeeks>
        {(cell) => (
          <CalendarDay
            className="hover:not-data-selected:bg-muted focus-visible:ring-ring/50 data-disabled:text-muted-foreground data-outside:text-muted-foreground data-selected:bg-primary data-selected:text-primary-foreground data-today:not-data-selected:bg-muted relative size-(--cell-size) cursor-default rounded-(--cell-radius) p-0 text-center text-xs leading-none outline-none select-none focus-visible:z-10 focus-visible:ring-[3px] data-disabled:opacity-50 data-disabled:hover:bg-transparent"
            value={cell.date}
          />
        )}
      </CalendarWeeks>
    </CalendarGrid>
  </DatePickerContentPrimitive>
);

export { DatePicker, DatePickerContent, DatePickerInput, DatePickerTrigger };
