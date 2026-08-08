export const THREAD_CACHE_MAX_AGE_MS = 5 * 60 * 1000;

export type ThreadCacheState = "fresh" | "miss" | "stale";

export const getThreadCacheState = (
  cachedAt: number | undefined,
  now: number
): ThreadCacheState => {
  if (cachedAt === undefined) {
    return "miss";
  }

  return now - cachedAt < THREAD_CACHE_MAX_AGE_MS ? "fresh" : "stale";
};
