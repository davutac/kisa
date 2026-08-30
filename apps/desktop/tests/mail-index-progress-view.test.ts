import { describe, expect, it } from "vitest";

import {
  toMailIndexDescription,
  toIndexRatio,
  toOverallIndexRatio,
} from "../src/renderer/src/mail/mail-index-progress-view";

describe("mail index progress view", () => {
  it("reports running, paused, and failed lifecycle states safely", () => {
    expect(toMailIndexDescription({ status: "running" })).toBe(
      "Indexing your complete Gmail history…"
    );
    expect(toMailIndexDescription({ status: "paused" })).toBe(
      "Mail history indexing is paused until this account is reconnected."
    );
    expect(toMailIndexDescription({ status: "failed" })).toBe(
      "Mail history indexing stopped. Reindex to try again."
    );
    expect(toMailIndexDescription({ status: "complete" })).toBe(
      "Refresh the local copy of your complete Gmail history."
    );
  });

  it("treats a manual reindex sentinel as indeterminate", () => {
    expect(
      toIndexRatio({ estimatedThreads: 0, indexedThreads: 18_000 })
    ).toBeUndefined();
  });

  it("clamps Gmail estimates and averages determinate accounts", () => {
    expect(toIndexRatio({ estimatedThreads: 100, indexedThreads: 120 })).toBe(
      1
    );
    expect(
      toOverallIndexRatio([
        { estimatedThreads: 200, indexedThreads: 100 },
        { estimatedThreads: 100, indexedThreads: 25 },
      ])
    ).toBe(0.375);
  });

  it("keeps combined progress indeterminate when any account is", () => {
    expect(
      toOverallIndexRatio([
        { estimatedThreads: 100, indexedThreads: 50 },
        { estimatedThreads: 0, indexedThreads: 18_000 },
      ])
    ).toBeUndefined();
  });
});
