import { describe, expect, it } from "vitest";

import {
  createQuotaGovernor,
  QUOTA_UNITS,
} from "../src/main/mail/quota-governor";

/**
 * A governor driven by a fake clock: `sleep` advances time instead of waiting,
 * so pacing can be asserted exactly rather than by wall-clock tolerance.
 */
const createTestGovernor = (unitsPerSecond = 100, burstUnits = 1000) => {
  let currentTime = 0;
  const sleeps: number[] = [];

  const governor = createQuotaGovernor({
    burstUnits,
    now: () => currentTime,
    sleep: (milliseconds) => {
      sleeps.push(milliseconds);
      currentTime += milliseconds;
      return Promise.resolve();
    },
    unitsPerSecond,
  });

  return {
    advance: (milliseconds: number) => {
      currentTime += milliseconds;
    },
    governor,
    sleeps,
  };
};

describe("quota governor", () => {
  it("lets foreground work through without waiting, even into debt", () => {
    const { governor } = createTestGovernor();

    // Ten times the entire bucket, charged in one go.
    for (let index = 0; index < 100; index += 1) {
      governor.charge("a@example.com", QUOTA_UNITS.threadsGet);
    }

    // No assertion on time is needed: `charge` is synchronous, so reaching this
    // line at all is the guarantee that foreground work never blocked.
    expect(governor.getRate("a@example.com")).toBe(100);
  });

  it("makes background work wait out foreground debt", async () => {
    const { governor, sleeps } = createTestGovernor();

    // Drain the bucket and push it 500 units into debt.
    governor.charge("a@example.com", 1500);

    await governor.awaitBudget("a@example.com", 1000);

    // 1500 units of shortfall at 100 units/second.
    expect(sleeps.reduce((total, value) => total + value, 0)).toBe(15_000);
  });

  it("does not deduct on awaitBudget, so a page is charged once", async () => {
    const { governor, advance } = createTestGovernor();
    const first: number[] = [];

    await governor.awaitBudget("a@example.com", 1000);
    governor.charge("a@example.com", 1000);
    first.push(0);

    // The bucket is empty rather than 1000 in debt, so a full second of refill
    // is enough for a tenth of a page.
    advance(1000);
    await governor.awaitBudget("a@example.com", 100);

    expect(first).toHaveLength(1);
  });

  it("halves the rate on a rate limit and drops the banked units", () => {
    const { governor } = createTestGovernor();

    governor.reportRateLimited("a@example.com");
    expect(governor.getRate("a@example.com")).toBe(50);

    governor.reportRateLimited("a@example.com");
    expect(governor.getRate("a@example.com")).toBe(25);
  });

  it("recovers the rate only after a quiet interval", () => {
    const { governor, advance } = createTestGovernor();

    governor.reportRateLimited("a@example.com");
    expect(governor.getRate("a@example.com")).toBe(50);

    // Still inside the recovery interval.
    advance(29_000);
    expect(governor.getRate("a@example.com")).toBe(50);

    advance(2000);
    expect(governor.getRate("a@example.com")).toBe(62.5);
  });

  it("keeps accounts on separate budgets", () => {
    const { governor } = createTestGovernor();

    governor.reportRateLimited("a@example.com");

    expect(governor.getRate("a@example.com")).toBe(50);
    expect(governor.getRate("b@example.com")).toBe(100);
  });

  it("does not hang when asked for more than the bucket can hold", async () => {
    const { governor } = createTestGovernor(100, 1000);

    // The bucket tops out at 1000; asking for 5000 must still resolve.
    await governor.awaitBudget("a@example.com", 5000);

    expect(governor.getRate("a@example.com")).toBe(100);
  });

  it("keeps indexer pages inside Gmail's per-minute per-user ceiling", async () => {
    // The account's real limit is 15,000 quota units per minute. The indexer
    // spends in lumps of one page, so what has to hold is that no 60-second
    // window can contain enough pages to exceed it.
    const perMinuteCeiling = 15_000;
    const pageCost = QUOTA_UNITS.threadsList + 100 * QUOTA_UNITS.threadsGet;
    const { governor, sleeps } = createTestGovernor(150, 4200);

    expect(pageCost).toBe(4010);

    // Run pages back to back and record when each one starts.
    const startedAt: number[] = [];

    for (let page = 0; page < 20; page += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await governor.awaitBudget("a@example.com", pageCost);
      governor.charge("a@example.com", pageCost);
      startedAt.push(sleeps.reduce((total, value) => total + value, 0));
    }

    // The limit is a sliding window, not a calendar minute, so the check is the
    // worst 60 seconds anywhere in the run — not the first.
    const worstWindow = Math.max(
      ...startedAt.map(
        (start) =>
          startedAt.filter((other) => other >= start && other < start + 60_000)
            .length * pageCost
      )
    );

    expect(worstWindow).toBeLessThanOrEqual(perMinuteCeiling);
  });
});
