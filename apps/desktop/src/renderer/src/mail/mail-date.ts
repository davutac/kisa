import type { Calendar } from "@/hooks/use-calendar";

/**
 * Mail dates follow desktop mail convention: the closer a message is, the less
 * of its date is worth reading. Buckets are calendar days in the calendar's
 * time zone rather than elapsed hours, so a message from 23:50 reads
 * "Yesterday" at 00:10. Wording and 12- or 24-hour time come from the
 * renderer's Intl locale, as for Kisa's other dates.
 */
export type MailDateVariant = "compact" | "detailed";

const WEEKDAY_WINDOW_DAYS = 6;
const DAY_MS = 86_400_000;

interface MailDateFormats {
  readonly day: Intl.DateTimeFormat;
  readonly exact: Intl.DateTimeFormat;
  readonly longMonthDay: Intl.DateTimeFormat;
  readonly longWeekday: Intl.DateTimeFormat;
  readonly longYearDate: Intl.DateTimeFormat;
  readonly monthDay: Intl.DateTimeFormat;
  readonly time: Intl.DateTimeFormat;
  readonly weekday: Intl.DateTimeFormat;
  readonly yearDate: Intl.DateTimeFormat;
}

// A formatter keeps the zone it was built with, so formats are keyed by zone
// and a time-zone change gets fresh ones instead of stale wall-clock times.
const formatsByTimeZone = new Map<string | undefined, MailDateFormats>();

const getFormats = (timeZone: string | undefined): MailDateFormats => {
  const cached = formatsByTimeZone.get(timeZone);

  if (cached !== undefined) {
    return cached;
  }

  const formats: MailDateFormats = {
    // Only ever split into parts, so its locale is fixed to plain digits.
    day: new Intl.DateTimeFormat("en-US", {
      calendar: "gregory",
      day: "numeric",
      month: "numeric",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
    }),
    exact: new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short",
      timeZone,
    }),
    longMonthDay: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      timeZone,
    }),
    longWeekday: new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "long",
    }),
    longYearDate: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "long",
      timeZone,
      year: "numeric",
    }),
    monthDay: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      timeZone,
    }),
    time: new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }),
    weekday: new Intl.DateTimeFormat(undefined, {
      timeZone,
      weekday: "short",
    }),
    yearDate: new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      timeZone,
      year: "numeric",
    }),
  };

  formatsByTimeZone.set(timeZone, formats);
  return formats;
};

const relativeDayFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: "auto",
});

interface CalendarDay {
  /** Whole days since the epoch, so differences survive daylight saving. */
  readonly index: number;
  readonly year: number;
}

const toCalendarDay = (
  timestamp: number,
  format: Intl.DateTimeFormat
): CalendarDay => {
  const parts = format.formatToParts(timestamp);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = read("year");

  return {
    index: Date.UTC(year, read("month") - 1, read("day")) / DAY_MS,
    year,
  };
};

const capitalize = (value: string): string =>
  `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;

/** The day part of a mail date, or `undefined` when it falls on today. */
const formatMailDay = (
  timestamp: number,
  now: number,
  formats: MailDateFormats
): string | undefined => {
  const day = toCalendarDay(timestamp, formats.day);
  const today = toCalendarDay(now, formats.day);
  const dayOffset = day.index - today.index;

  if (dayOffset === 0) {
    return undefined;
  }

  if (Math.abs(dayOffset) === 1) {
    return capitalize(relativeDayFormat.format(dayOffset, "day"));
  }

  // A bare weekday only reads unambiguously for the week behind us.
  if (dayOffset < 0 && dayOffset >= -WEEKDAY_WINDOW_DAYS) {
    return formats.weekday.format(timestamp);
  }

  return day.year === today.year
    ? formats.monthDay.format(timestamp)
    : formats.yearDate.format(timestamp);
};

/**
 * `compact` suits lists: today's time, then "Yesterday", a weekday, or a date.
 * `detailed` adds the time to every day so a single message can be placed.
 */
export const formatMailDate = (
  timestamp: number,
  { now, timeZone }: Calendar,
  variant: MailDateVariant = "compact"
): string => {
  const formats = getFormats(timeZone);
  const day = formatMailDay(timestamp, now, formats);

  if (day === undefined) {
    return formats.time.format(timestamp);
  }

  return variant === "compact"
    ? day
    : `${day}, ${formats.time.format(timestamp)}`;
};

export const formatExactMailDate = (
  timestamp: number,
  { timeZone }: Pick<Calendar, "timeZone">
): string => getFormats(timeZone).exact.format(timestamp);

/** The calendar day a timestamp falls on, comparable between timestamps. */
export const getMailDayIndex = (
  timestamp: number,
  { timeZone }: Pick<Calendar, "timeZone">
): number => toCalendarDay(timestamp, getFormats(timeZone).day).index;

/**
 * A heading for the day a list's mail arrived on, spelled out in full:
 * "Today", "Yesterday", a weekday for the week behind us, then a date.
 */
export const formatMailDayHeading = (
  timestamp: number,
  { now, timeZone }: Calendar
): string => {
  const formats = getFormats(timeZone);
  const day = toCalendarDay(timestamp, formats.day);
  const today = toCalendarDay(now, formats.day);
  const dayOffset = day.index - today.index;

  if (Math.abs(dayOffset) <= 1) {
    return capitalize(relativeDayFormat.format(dayOffset, "day"));
  }

  if (dayOffset < 0 && dayOffset >= -WEEKDAY_WINDOW_DAYS) {
    return formats.longWeekday.format(timestamp);
  }

  return day.year === today.year
    ? formats.longMonthDay.format(timestamp)
    : formats.longYearDate.format(timestamp);
};
