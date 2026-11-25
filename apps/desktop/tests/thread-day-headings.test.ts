import { describe, expect, it } from "vitest";

import { formatMailDayHeading } from "../src/renderer/src/mail/mail-date";
import {
  getPinnedDayHeading,
  isFirstOfDay,
  isNewestFirst,
} from "../src/renderer/src/mail/thread-day-headings";

const localTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

const at = (month: number, day: number, hours = 12, year = 2026): number =>
  new Date(year, month, day, hours).getTime();

// Wednesday, 18 November 2026, 10:00 local time.
const calendar = { now: at(10, 18, 10), timeZone: localTimeZone };

const relativeDay = (offset: number): string => {
  const value = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  }).format(offset, "day");
  return `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}`;
};
const inZone = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...options, timeZone: localTimeZone });

describe(formatMailDayHeading, () => {
  it("names today and yesterday, then the weekday, then the date", () => {
    expect(
      [
        at(10, 18, 9),
        at(10, 17, 23),
        at(10, 13),
        at(10, 11),
        at(10, 3, 12, 2025),
      ].map((timestamp) => formatMailDayHeading(timestamp, calendar))
    ).toStrictEqual([
      relativeDay(0),
      relativeDay(-1),
      inZone({ weekday: "long" }).format(at(10, 13)),
      inZone({ day: "numeric", month: "long" }).format(at(10, 11)),
      inZone({ day: "numeric", month: "long", year: "numeric" }).format(
        at(10, 3, 12, 2025)
      ),
    ]);
  });
});

describe(isFirstOfDay, () => {
  const threads = [
    { latestAt: at(10, 18, 9) },
    { latestAt: at(10, 18, 1) },
    { latestAt: at(10, 17, 23) },
    { latestAt: at(10, 17, 8) },
    { latestAt: at(10, 11) },
  ];

  it("opens a day only on its first row, and none past the end", () => {
    expect(
      [0, 1, 2, 3, 4, 5].map((index) => isFirstOfDay(threads, index, calendar))
    ).toStrictEqual([true, false, true, false, true, false]);
  });
});

describe(getPinnedDayHeading, () => {
  // Out of order, as exiting rows can leave them in the DOM.
  const rows = [
    { day: "Monday", height: 80, top: 113 },
    { day: "Tuesday", height: 113, top: 0 },
    { day: "Monday", height: 80, top: 193 },
  ];

  it("pins the day at the top and lets the next day's heading lift it", () => {
    expect(
      [0, 50, 82, 100, 112, 113, 400].map((scrollTop) =>
        getPinnedDayHeading(rows, scrollTop, 31)
      )
    ).toStrictEqual([
      { day: "Tuesday", offset: 0 },
      { day: "Tuesday", offset: 0 },
      { day: "Tuesday", offset: 0 },
      { day: "Tuesday", offset: -18 },
      { day: "Tuesday", offset: -30 },
      { day: "Monday", offset: 0 },
      undefined,
    ]);
  });
});

describe(isNewestFirst, () => {
  it("groups lists ordered by date and not lists ranked by relevance", () => {
    expect({
      empty: isNewestFirst([]),
      newestFirst: isNewestFirst([
        { latestAt: 3 },
        { latestAt: 3 },
        { latestAt: 1 },
      ]),
      ranked: isNewestFirst([{ latestAt: 1 }, { latestAt: 3 }]),
    }).toStrictEqual({ empty: true, newestFirst: true, ranked: false });
  });
});
