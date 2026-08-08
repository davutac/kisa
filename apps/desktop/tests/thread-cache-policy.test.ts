import { describe, expect, it } from "vitest";

import {
  getThreadCacheState,
  THREAD_CACHE_MAX_AGE_MS,
} from "../src/main/mail/thread-cache-policy";

describe("thread cache policy", () => {
  const now = 1_000_000;

  it("fetches from Gmail when the cache is empty", () => {
    expect(getThreadCacheState(undefined, now)).toBe("miss");
  });

  it("uses a cached thread without refreshing while it is fresh", () => {
    expect(getThreadCacheState(now - THREAD_CACHE_MAX_AGE_MS + 1, now)).toBe(
      "fresh"
    );
  });

  it("refreshes a cached thread once it reaches the maximum age", () => {
    expect(getThreadCacheState(now - THREAD_CACHE_MAX_AGE_MS, now)).toBe(
      "stale"
    );
  });
});
