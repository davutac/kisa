import { describe, expect, it } from "vitest";

import {
  mergeWatermark,
  oldestTimestamp,
  toBeforeQuery,
} from "../src/main/mail/mail-backfill-cursor";

const at = (
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0
): number => new Date(year, month - 1, day, hour, minute).getTime();

describe(toBeforeQuery, () => {
  it("asks for the day after the watermark so the walk overlaps", () => {
    // A gap loses mail permanently; an overlap costs one re-walked day and is
    // absorbed by the upserts. The query must therefore never be `03/14`.
    expect(toBeforeQuery("-in:chats", at(2019, 3, 14, 18, 4))).toBe(
      "-in:chats before:2019/03/15"
    );
  });

  it("still overlaps for a watermark just after midnight", () => {
    expect(toBeforeQuery("-in:chats", at(2019, 3, 14, 0, 1))).toBe(
      "-in:chats before:2019/03/15"
    );
  });

  it("still overlaps for a watermark exactly at midnight", () => {
    expect(toBeforeQuery("-in:chats", at(2019, 3, 14))).toBe(
      "-in:chats before:2019/03/15"
    );
  });

  it("rolls over month and year boundaries", () => {
    expect(toBeforeQuery("-in:chats", at(2019, 1, 31, 23, 59))).toBe(
      "-in:chats before:2019/02/01"
    );
    expect(toBeforeQuery("-in:chats", at(2019, 12, 31, 12))).toBe(
      "-in:chats before:2020/01/01"
    );
  });

  it("pads single-digit months and days", () => {
    expect(toBeforeQuery("q", at(2020, 2, 8))).toBe("q before:2020/02/09");
  });
});

describe(oldestTimestamp, () => {
  it("returns the smallest usable timestamp", () => {
    expect(oldestTimestamp([300, 100, 200])).toBe(100);
  });

  it("ignores unparsable and zero timestamps", () => {
    // A zero would restart the whole walk at the epoch on the next resume.
    expect(oldestTimestamp([0, Number.NaN, 500])).toBe(500);
  });

  it("returns null when a page carries nothing usable", () => {
    expect(oldestTimestamp([])).toBeNull();
    expect(oldestTimestamp([0, Number.NaN])).toBeNull();
  });
});

describe(mergeWatermark, () => {
  it("takes the first timestamp when there is no watermark yet", () => {
    expect(mergeWatermark(null, 500)).toBe(500);
  });

  it("only ever moves backwards", () => {
    expect(mergeWatermark(500, 200)).toBe(200);
    // A replayed page carrying newer threads must not rewind the watermark
    // forward, or the resume would skip everything between.
    expect(mergeWatermark(200, 500)).toBe(200);
  });

  it("keeps the current watermark when a page yields nothing", () => {
    expect(mergeWatermark(200, null)).toBe(200);
    expect(mergeWatermark(null, null)).toBeNull();
  });
});
