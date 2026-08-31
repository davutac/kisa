import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getInitialCustomSchedule,
  getSchedulePresets,
  getScheduledDueCheckDelay,
  MAX_SCHEDULE_TIMER_DELAY,
  resolveLocalScheduleTime,
  toTimeInputValue,
} from "../src/renderer/src/scheduled/schedule-time";

describe("scheduled mail time choices", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("builds the exact tomorrow and next-Monday presets in local time", () => {
    const now = new Date(2026, 7, 30, 16, 42);

    expect(
      getSchedulePresets(now).map(({ id, label, scheduledAt }) => ({
        date: new Date(scheduledAt),
        id,
        label,
      }))
    ).toStrictEqual([
      {
        date: new Date(2026, 7, 31, 8),
        id: "tomorrow-morning",
        label: "Tomorrow morning at 08:00",
      },
      {
        date: new Date(2026, 7, 31, 13),
        id: "tomorrow-afternoon",
        label: "Tomorrow afternoon at 13:00",
      },
      {
        date: new Date(2026, 7, 31, 8),
        id: "next-monday-morning",
        label: "next Monday at 08:00",
      },
    ]);
  });

  it("uses the following week when today is Monday", () => {
    const presets = getSchedulePresets(new Date(2026, 7, 31, 9));

    expect(new Date(presets[2]?.scheduledAt ?? 0)).toStrictEqual(
      new Date(2026, 8, 7, 8)
    );
  });

  it("rounds the custom default to a future half hour", () => {
    expect(
      getInitialCustomSchedule(new Date(2026, 7, 30, 16, 42))
    ).toStrictEqual(new Date(2026, 7, 30, 17, 30));
    expect(toTimeInputValue(new Date(2026, 7, 30, 8, 5))).toBe("08:05");
  });

  it("chains due checks for schedules beyond the platform timer limit", () => {
    const now = new Date(2026, 7, 30).getTime();
    const scheduledAt = new Date(2026, 9, 30).getTime();

    expect(getScheduledDueCheckDelay(scheduledAt, now)).toBe(
      MAX_SCHEDULE_TIMER_DELAY
    );
    expect(getScheduledDueCheckDelay(scheduledAt, scheduledAt - 500)).toBe(500);
    expect(getScheduledDueCheckDelay(scheduledAt, scheduledAt)).toBe(0);
  });

  it("requires a valid future local date and time", () => {
    const now = new Date(2026, 7, 30, 16).getTime();

    expect(resolveLocalScheduleTime(undefined, "17:00", now)).toStrictEqual({
      error: "Choose a date",
      ok: false,
    });
    expect(
      resolveLocalScheduleTime(new Date(2026, 7, 30), "later", now)
    ).toStrictEqual({ error: "Choose a valid time", ok: false });
    expect(
      resolveLocalScheduleTime(new Date(2026, 7, 30), "15:00", now)
    ).toStrictEqual({ error: "Choose a time in the future", ok: false });
    expect(
      resolveLocalScheduleTime(new Date(2026, 7, 30), "17:00", now)
    ).toStrictEqual({
      ok: true,
      scheduledAt: new Date(2026, 7, 30, 17).getTime(),
    });
  });

  it("rejects a wall time normalized across a daylight-saving gap", () => {
    vi.stubEnv("TZ", "Europe/Berlin");
    const result = resolveLocalScheduleTime(
      new Date(2026, 2, 29),
      "02:30",
      new Date(2026, 2, 28).getTime()
    );

    expect(result).toStrictEqual({
      error: "That time does not exist in your current timezone",
      ok: false,
    });
  });

  it("rejects a wall time repeated during a daylight-saving fallback", () => {
    vi.stubEnv("TZ", "Europe/Berlin");
    const result = resolveLocalScheduleTime(
      new Date(2026, 9, 25),
      "02:30",
      new Date(2026, 9, 24).getTime()
    );

    expect(result).toStrictEqual({
      error:
        "That time occurs twice in your current timezone; choose another time",
      ok: false,
    });
  });
});
