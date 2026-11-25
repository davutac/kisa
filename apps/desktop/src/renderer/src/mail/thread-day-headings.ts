import type { Calendar } from "@/hooks/use-calendar";
import { getMailDayIndex } from "@/mail/mail-date";
import type { MailThreadSummary } from "@/shared/ipc/mail";

type DatedThread = Pick<MailThreadSummary, "latestAt">;

/**
 * Day headings only read as groups in a list ordered by date; search results
 * ranked by relevance hop between days, so they get none.
 */
export const isNewestFirst = (threads: readonly DatedThread[]): boolean =>
  threads.every(
    (thread, index) =>
      index === 0 || (threads[index - 1]?.latestAt ?? 0) >= thread.latestAt
  );

/**
 * Whether the row at `index` opens its day, so only rendered rows are ever
 * compared, however long the list is.
 */
export const isFirstOfDay = (
  threads: readonly DatedThread[],
  index: number,
  calendar: Calendar
): boolean => {
  const thread = threads[index];

  if (thread === undefined) {
    return false;
  }

  const previous = threads[index - 1];

  return (
    previous === undefined ||
    getMailDayIndex(previous.latestAt, calendar) !==
      getMailDayIndex(thread.latestAt, calendar)
  );
};

export interface DayRow {
  readonly day: string;
  readonly height: number;
  readonly top: number;
}

/**
 * The pinned heading for a list scrolled `scrollTop` into its rows: the day of
 * the first row still in view, lifted by the next day's heading as it arrives
 * so the two never overlap. `bandHeight` is how much of a row the heading
 * takes. Rows are the rendered ones, in any order.
 */
export const getPinnedDayHeading = (
  rows: readonly DayRow[],
  scrollTop: number,
  bandHeight: number
): { readonly day: string; readonly offset: number } | undefined => {
  const ordered = rows.toSorted((left, right) => left.top - right.top);
  const currentIndex = ordered.findIndex(
    (row) => row.top + row.height > scrollTop
  );
  const current = ordered[currentIndex];

  if (current === undefined) {
    return undefined;
  }

  const next = ordered
    .slice(currentIndex + 1)
    .find((row) => row.day !== current.day);

  return {
    day: current.day,
    offset:
      next === undefined ? 0 : Math.min(0, next.top - scrollTop - bandHeight),
  };
};
