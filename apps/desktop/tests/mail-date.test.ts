import { afterEach, describe, expect, it, vi } from "vitest";

import { calendarStore } from "../src/renderer/src/hooks/use-calendar";
import {
  formatExactMailDate,
  formatMailDate,
} from "../src/renderer/src/mail/mail-date";

const localTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

// Expected strings come from the system locale, as the app's do, so these
// tests pin which part of a date is shown rather than one locale's spelling.
const inZone = (
  options: Intl.DateTimeFormatOptions,
  timeZone = localTimeZone
): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone });
const time = inZone({ hour: "numeric", minute: "2-digit" });
const weekday = inZone({ weekday: "short" });
const monthDay = inZone({ day: "numeric", month: "short" });
const yearDate = inZone({ day: "numeric", month: "short", year: "numeric" });
const relativeDay = (offset: number): string => {
  const value = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  }).format(offset, "day");
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
};

const at = (
  month: number,
  day: number,
  hours = 12,
  minutes = 0,
  year = 2026
): number => new Date(year, month, day, hours, minutes).getTime();

// Wednesday, 18 November 2026, 10:00 local time.
const calendar = { now: at(10, 18, 10), timeZone: localTimeZone };

describe(formatMailDate, () => {
  it("shows only the time for today's mail", () => {
    const sentAt = at(10, 18, 8, 5);

    expect(formatMailDate(sentAt, calendar)).toBe(time.format(sentAt));
    expect(formatMailDate(sentAt, calendar, "detailed")).toBe(
      time.format(sentAt)
    );
  });

  it("buckets by calendar day rather than elapsed hours", () => {
    const lateLastNight = at(10, 17, 23, 50);
    const justAfterMidnight = {
      now: at(10, 18, 0, 10),
      timeZone: localTimeZone,
    };

    expect(formatMailDate(lateLastNight, justAfterMidnight)).toBe(
      relativeDay(-1)
    );
    expect(formatMailDate(lateLastNight, justAfterMidnight, "detailed")).toBe(
      `${relativeDay(-1)}, ${time.format(lateLastNight)}`
    );
  });

  it("names the weekday for the past six days, then switches to a date", () => {
    const sixDaysAgo = at(10, 12);
    const sevenDaysAgo = at(10, 11);

    expect(formatMailDate(sixDaysAgo, calendar)).toBe(
      weekday.format(sixDaysAgo)
    );
    expect(formatMailDate(sevenDaysAgo, calendar)).toBe(
      monthDay.format(sevenDaysAgo)
    );
    expect(formatMailDate(sevenDaysAgo, calendar, "detailed")).toBe(
      `${monthDay.format(sevenDaysAgo)}, ${time.format(sevenDaysAgo)}`
    );
  });

  it("keeps the weekday across New Year before switching to a dated year", () => {
    const december30 = at(11, 30, 12, 0, 2025);
    const january2 = { now: at(0, 2, 9), timeZone: localTimeZone };

    expect(formatMailDate(december30, january2)).toBe(
      weekday.format(december30)
    );
  });

  it("adds the year only for other years", () => {
    const january = at(0, 2);
    const lastYear = at(11, 30, 12, 0, 2025);

    expect(formatMailDate(january, calendar)).toBe(monthDay.format(january));
    expect(formatMailDate(lastYear, calendar)).toBe(yearDate.format(lastYear));
  });

  it("never uses a bare weekday for a future date", () => {
    const tomorrow = at(10, 19, 8);
    const nextWeek = at(10, 21, 8);

    expect(formatMailDate(tomorrow, calendar, "detailed")).toBe(
      `${relativeDay(1)}, ${time.format(tomorrow)}`
    );
    expect(formatMailDate(nextWeek, calendar)).toBe(monthDay.format(nextWeek));
  });

  it("buckets and formats in the calendar's time zone, not the startup one", () => {
    // 23:30 UTC is still the afternoon in Los Angeles but already tomorrow in
    // Berlin, relative to 20:00 UTC on the same day.
    const sentAt = Date.UTC(2026, 10, 18, 23, 30);
    const now = Date.UTC(2026, 10, 18, 20);
    const losAngeles = "America/Los_Angeles";

    expect(formatMailDate(sentAt, { now, timeZone: losAngeles })).toBe(
      inZone({ hour: "numeric", minute: "2-digit" }, losAngeles).format(sentAt)
    );
    expect(formatMailDate(sentAt, { now, timeZone: "Europe/Berlin" })).toBe(
      relativeDay(1)
    );
  });

  it("keeps a daylight-saving night one calendar day long", () => {
    // Berlin skips 02:00-03:00 on 29 March 2026. 00:30 that night is still
    // the day before the Monday morning it is read on.
    const sentAt = Date.UTC(2026, 2, 28, 23, 30);
    const mondayMorning = Date.UTC(2026, 2, 30, 7);

    expect(
      formatMailDate(sentAt, { now: mondayMorning, timeZone: "Europe/Berlin" })
    ).toBe(relativeDay(-1));
  });

  it("spells out the full date and time for tooltips", () => {
    const sentAt = at(10, 18, 8, 5);

    expect(formatExactMailDate(sentAt, calendar)).toBe(
      inZone({ dateStyle: "full", timeStyle: "short" }).format(sentAt)
    );
  });
});

const subscribeAt = (start: Date) => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  vi.stubGlobal("window", new EventTarget());
  const listener = vi.fn<() => void>();
  const unsubscribe = calendarStore.subscribe(listener);
  // Subscribing re-reads a calendar captured at import under the real clock.
  listener.mockClear();
  return { listener, unsubscribe };
};

describe("the shared calendar", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("moves to the new day within a minute of midnight", () => {
    const { listener, unsubscribe } = subscribeAt(
      new Date(2026, 10, 18, 23, 59, 30)
    );
    const before = calendarStore.getSnapshot();

    vi.advanceTimersByTime(29_000);
    const callsBeforeMidnight = listener.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    unsubscribe();

    expect({
      callsAfterMidnight: listener.mock.calls.length,
      callsBeforeMidnight,
      dayAfter: new Date(calendarStore.getSnapshot().now).getDate(),
      dayBefore: new Date(before.now).getDate(),
    }).toStrictEqual({
      callsAfterMidnight: 1,
      callsBeforeMidnight: 0,
      dayAfter: 19,
      dayBefore: 18,
    });
  });

  it("catches up after sleep even when the window never lost focus", () => {
    const { listener, unsubscribe } = subscribeAt(new Date(2026, 10, 18, 22));

    // Timers pause during sleep, so the wall clock jumps past midnight with
    // no timer having run and no focus event to follow.
    vi.setSystemTime(new Date(2026, 10, 19, 8));
    vi.advanceTimersByTime(60_000);
    unsubscribe();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("falls back to the default zone when the system zone cannot be loaded", () => {
    const options = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...options,
      timeZone: "Etc/Unknown",
    });
    const { unsubscribe } = subscribeAt(new Date(2026, 10, 18, 10));
    const fallback = calendarStore.getSnapshot();
    vi.restoreAllMocks();
    unsubscribe();

    expect({
      date: formatMailDate(at(10, 18, 8, 5), fallback),
      timeZone: fallback.timeZone,
    }).toStrictEqual({
      date: time.format(at(10, 18, 8, 5)),
      timeZone: undefined,
    });
  });

  it("re-reads on focus and stops once the last subscriber leaves", () => {
    const { listener, unsubscribe } = subscribeAt(new Date(2026, 10, 18, 10));

    vi.setSystemTime(new Date(2026, 10, 20, 9));
    window.dispatchEvent(new Event("focus"));
    unsubscribe();
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(2 * 86_400_000);

    expect({
      calls: listener.mock.calls.length,
      timers: vi.getTimerCount(),
    }).toStrictEqual({ calls: 1, timers: 0 });
  });
});
