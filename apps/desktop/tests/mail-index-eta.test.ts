import { describe, expect, it } from "vitest";

import {
  advanceEtas,
  estimateRemainingMs,
  formatRemaining,
} from "../src/renderer/src/mail/mail-index-eta";
import type { AccountSamples } from "../src/renderer/src/mail/mail-index-eta";

const running = (indexedThreads: number, estimatedThreads = 10_000) => [
  {
    accountId: "one@example.com",
    estimatedThreads,
    indexedThreads,
    status: "running",
  },
];

describe(estimateRemainingMs, () => {
  it("projects remaining time from observed throughput", () => {
    // 100 threads in 20 seconds is 5/second, so 500 left is 100 seconds.
    expect(
      estimateRemainingMs(
        { at: 0, indexedThreads: 1000 },
        { at: 20_000, indexedThreads: 1100 },
        500
      )
    ).toBe(100_000);
  });

  it("waits for enough elapsed time before estimating", () => {
    // A large jump over a tiny window would project an absurdly fast finish.
    expect(
      estimateRemainingMs(
        { at: 0, indexedThreads: 1000 },
        { at: 2000, indexedThreads: 1100 },
        500
      )
    ).toBeUndefined();
  });

  it("waits for enough threads before estimating", () => {
    expect(
      estimateRemainingMs(
        { at: 0, indexedThreads: 1000 },
        { at: 60_000, indexedThreads: 1005 },
        500
      )
    ).toBeUndefined();
  });

  it("gives no estimate once nothing is left", () => {
    expect(
      estimateRemainingMs(
        { at: 0, indexedThreads: 1000 },
        { at: 60_000, indexedThreads: 1500 },
        0
      )
    ).toBeUndefined();
  });

  it("gives no estimate when progress has stalled", () => {
    // Zero throughput would otherwise divide to Infinity.
    expect(
      estimateRemainingMs(
        { at: 0, indexedThreads: 1000 },
        { at: 60_000, indexedThreads: 1000 },
        500
      )
    ).toBeUndefined();
  });
});

describe(formatRemaining, () => {
  it("rounds to units a reader can act on", () => {
    expect(formatRemaining(30_000)).toBe("less than a minute left");
    expect(formatRemaining(90_000)).toBe("~2 min left");
    expect(formatRemaining(45 * 60_000)).toBe("~45 min left");
    expect(formatRemaining(3_600_000)).toBe("~1 h left");
    expect(formatRemaining(80 * 60_000)).toBe("~1 h 20 min left");
  });

  it("carries a rounded remainder instead of showing sixty minutes", () => {
    // 1h 59m 45s rounds the remainder to 60 minutes.
    expect(formatRemaining(3_600_000 + 59.75 * 60_000)).toBe("~2 h left");
  });

  it("does not pretend to estimate beyond a day", () => {
    expect(formatRemaining(30 * 3_600_000)).toBe("over a day left");
  });
});

describe(advanceEtas, () => {
  it("produces no estimate from a single observation", () => {
    const samples = new Map<string, AccountSamples>();

    expect([...advanceEtas(samples, running(1000), 0)]).toStrictEqual([]);
  });

  it("estimates once enough of the run has been observed", () => {
    const samples = new Map<string, AccountSamples>();

    advanceEtas(samples, running(1000), 0);

    // 500 threads in 20s is 25/second; 8,500 remain, so ~340s — quantised
    // down to the nearest half minute.
    expect([...advanceEtas(samples, running(1500), 20_000)]).toStrictEqual([
      ["one@example.com", 330_000],
    ]);
  });

  it("measures from when the run was first seen, not from zero", () => {
    const samples = new Map<string, AccountSamples>();

    // Joining mid-run: 9,000 were already indexed before the first sample, and
    // counting them would overstate throughput enormously.
    advanceEtas(samples, running(9000), 100_000);

    // 25/second against 500 remaining is 20s, which quantises up to 30s. Had
    // it measured from zero it would read 9,500 in 120s and predict ~6s.
    expect([...advanceEtas(samples, running(9500), 120_000)]).toStrictEqual([
      ["one@example.com", 30_000],
    ]);
  });

  it("forgets an account that stops running", () => {
    const samples = new Map<string, AccountSamples>();

    advanceEtas(samples, running(1000), 0);
    advanceEtas(
      samples,
      [
        {
          accountId: "one@example.com",
          estimatedThreads: 10_000,
          indexedThreads: 1500,
          status: "paused",
        },
      ],
      20_000
    );

    expect(samples.has("one@example.com")).toBeFalsy();
    // Resuming starts a fresh measurement rather than spanning the pause.
    expect([...advanceEtas(samples, running(1500), 40_000)]).toStrictEqual([]);
  });

  it("restarts when the indexed count goes backwards", () => {
    const samples = new Map<string, AccountSamples>();

    advanceEtas(samples, running(5000), 0);
    advanceEtas(samples, running(100), 20_000);

    expect(samples.get("one@example.com")?.first.indexedThreads).toBe(100);
  });

  it("skips accounts with no total to measure against", () => {
    const samples = new Map<string, AccountSamples>();
    const noTotal = [
      {
        accountId: "one@example.com",
        indexedThreads: 1000,
        status: "running",
      },
    ];

    advanceEtas(samples, noTotal, 0);

    expect([
      ...advanceEtas(
        samples,
        [
          {
            accountId: "one@example.com",
            indexedThreads: 2000,
            status: "running",
          },
        ],
        20_000
      ),
    ]).toStrictEqual([]);
  });
});
