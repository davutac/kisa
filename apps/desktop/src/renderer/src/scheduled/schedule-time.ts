export type SchedulePresetId =
  | "next-monday-morning"
  | "tomorrow-afternoon"
  | "tomorrow-morning";

export interface SchedulePreset {
  readonly id: SchedulePresetId;
  readonly label: string;
  readonly scheduledAt: number;
}

export const MAX_SCHEDULE_TIMER_DELAY = 2_147_483_647;
export const LOCAL_TIME_ZONE =
  new Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";

const scheduledAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const getScheduledDueCheckDelay = (
  scheduledAt: number,
  now: number
): number => Math.max(0, Math.min(scheduledAt - now, MAX_SCHEDULE_TIMER_DELAY));

export type LocalScheduleTimeResult =
  | { readonly error: string; readonly ok: false }
  | { readonly ok: true; readonly scheduledAt: number };

const atLocalTime = (date: Date, hours: number, minutes = 0): Date =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    0,
    0
  );

const addLocalDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const getSchedulePresets = (now: Date): readonly SchedulePreset[] => {
  const tomorrow = addLocalDays(now, 1);
  const daysUntilNextMonday = (8 - now.getDay()) % 7 || 7;
  const nextMonday = addLocalDays(now, daysUntilNextMonday);

  return [
    {
      id: "tomorrow-morning",
      label: "Tomorrow morning at 08:00",
      scheduledAt: atLocalTime(tomorrow, 8).getTime(),
    },
    {
      id: "tomorrow-afternoon",
      label: "Tomorrow afternoon at 13:00",
      scheduledAt: atLocalTime(tomorrow, 13).getTime(),
    },
    {
      id: "next-monday-morning",
      label: "next Monday at 08:00",
      scheduledAt: atLocalTime(nextMonday, 8).getTime(),
    },
  ];
};

const TIME_PATTERN = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/u;

const hasSameLocalParts = (
  candidate: Date,
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): boolean =>
  candidate.getFullYear() === year &&
  candidate.getMonth() === month &&
  candidate.getDate() === day &&
  candidate.getHours() === hours &&
  candidate.getMinutes() === minutes;

/**
 * Resolves a wall-clock selection to one fixed instant. Missing and repeated
 * daylight-saving times are rejected instead of silently moving or choosing
 * one of two possible deliveries.
 */
export const resolveLocalScheduleTime = (
  selectedDay: Date | undefined,
  time: string,
  now = Date.now()
): LocalScheduleTimeResult => {
  if (selectedDay === undefined) {
    return { error: "Choose a date", ok: false };
  }

  const match = TIME_PATTERN.exec(time);
  if (match?.groups === undefined) {
    return { error: "Choose a valid time", ok: false };
  }

  const hours = Number(match.groups.hours);
  const minutes = Number(match.groups.minutes);
  const year = selectedDay.getFullYear();
  const month = selectedDay.getMonth();
  const day = selectedDay.getDate();
  const candidate = new Date(year, month, day, hours, minutes, 0, 0);

  if (!hasSameLocalParts(candidate, year, month, day, hours, minutes)) {
    return {
      error: "That time does not exist in your current timezone",
      ok: false,
    };
  }

  const matchingInstants = new Set<number>([candidate.getTime()]);
  const threeHoursInMinutes = 3 * 60;

  // Timezone transitions are not universally one hour. A 15-minute scan also
  // catches the half-hour fallback used by zones such as Australia/Lord_Howe.
  for (
    let offset = -threeHoursInMinutes;
    offset <= threeHoursInMinutes;
    offset += 15
  ) {
    if (offset === 0) {
      continue;
    }
    const alternative = new Date(candidate.getTime() + offset * 60_000);
    if (hasSameLocalParts(alternative, year, month, day, hours, minutes)) {
      matchingInstants.add(alternative.getTime());
    }
  }

  if (matchingInstants.size > 1) {
    return {
      error:
        "That time occurs twice in your current timezone; choose another time",
      ok: false,
    };
  }

  if (candidate.getTime() <= now) {
    return { error: "Choose a time in the future", ok: false };
  }

  return { ok: true, scheduledAt: candidate.getTime() };
};

export const getInitialCustomSchedule = (now: Date): Date => {
  const minimum = new Date(now.getTime() + 30 * 60_000);
  minimum.setSeconds(0, 0);
  const remainder = minimum.getMinutes() % 30;
  if (remainder !== 0) {
    minimum.setMinutes(minimum.getMinutes() + (30 - remainder));
  }
  return minimum;
};

export const toTimeInputValue = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export const formatScheduledAt = (scheduledAt: number): string =>
  scheduledAtFormatter.format(new Date(scheduledAt));
