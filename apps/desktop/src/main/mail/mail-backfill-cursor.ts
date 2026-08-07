const DAY_MS = 86_400_000;

/**
 * Builds the resume query for a partly-indexed account.
 *
 * Gmail's `before:` takes a date, not an instant, so it cannot express "resume
 * from 18:04 on the 14th". Anchoring on the watermark's own day would drop
 * everything indexed later that same day, so the query deliberately asks for
 * the day *after* the watermark and re-walks the overlap. Overlapping is the
 * safe direction — every write is an upsert, whereas a gap is permanent.
 *
 * Local date parts are used because Gmail interprets `before:` in the user's
 * own timezone.
 */
export const toBeforeQuery = (
  baseQuery: string,
  oldestIndexedAt: number
): string => {
  const date = new Date(oldestIndexedAt + DAY_MS);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${baseQuery} before:${date.getFullYear()}/${month}/${day}`;
};

/**
 * The oldest timestamp in a page, which becomes the durable restart point.
 * Threads whose timestamp did not parse are ignored rather than poisoning the
 * watermark with a zero that would restart the walk at the epoch.
 */
export const oldestTimestamp = (
  timestamps: readonly number[]
): number | null => {
  const usable = timestamps.filter(
    (value) => Number.isFinite(value) && value > 0
  );

  return usable.length === 0 ? null : Math.min(...usable);
};

/** Watermarks only ever move backwards, so a replayed page cannot rewind it. */
export const mergeWatermark = (
  current: number | null,
  next: number | null
): number | null => {
  if (next === null) {
    return current;
  }

  return current === null ? next : Math.min(current, next);
};
