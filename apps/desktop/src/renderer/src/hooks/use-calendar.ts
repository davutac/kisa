import { useSyncExternalStore } from "react";

/** The day and time zone that dates on screen are drawn against. */
export interface Calendar {
  /** When this calendar was read; only its day in `timeZone` matters. */
  readonly now: number;
  /** Absent when the system zone is one Intl cannot load by name. */
  readonly timeZone?: string;
}

const REFRESH_INTERVAL_MS = 60_000;

const listeners = new Set<() => void>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;

// An unrecognised system zone resolves to a name such as "Etc/Unknown" that
// Intl then refuses as an option; formatting falls back to the implicit
// default zone instead of throwing on every date.
const readTimeZone = (): string | undefined => {
  const { timeZone } = new Intl.DateTimeFormat().resolvedOptions();

  try {
    return new Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return undefined;
  }
};

// Resolving the zone builds Intl formatters, which is too slow to repeat on
// every render, so it is read only when the calendar refreshes.
const readCalendar = (): Calendar => ({
  now: Date.now(),
  timeZone: readTimeZone(),
});

let calendar = readCalendar();

const isSameCalendar = (left: Calendar, right: Calendar): boolean =>
  left.timeZone === right.timeZone &&
  new Date(left.now).toDateString() === new Date(right.now).toDateString();

const refresh = (): void => {
  const next = readCalendar();

  if (isSameCalendar(next, calendar)) {
    return;
  }

  calendar = next;

  for (const listener of listeners) {
    listener();
  }
};

/**
 * One shared calendar for every date on screen. A midnight timer would run
 * late after sleep, when Chromium's timers pause, and would not notice a
 * time-zone change, so the calendar is re-read every minute and whenever the
 * window regains focus. Subscribers re-render only when the day or zone
 * actually changed.
 */
export const calendarStore = {
  getSnapshot: (): Calendar => calendar,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);

    if (listeners.size === 1) {
      refresh();
      refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
      window.addEventListener("focus", refresh);
    }

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0) {
        clearInterval(refreshTimer);
        refreshTimer = undefined;
        window.removeEventListener("focus", refresh);
      }
    };
  },
};

export const useCalendar = (): Calendar =>
  useSyncExternalStore(
    calendarStore.subscribe,
    calendarStore.getSnapshot,
    calendarStore.getSnapshot
  );
