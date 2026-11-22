import { describe, expect, it } from "vitest";

import { toMailIndexDescription } from "../src/renderer/src/mail/mail-index-progress-view";
import {
  toMailIndexRatio,
  toOverallMailIndexRatio,
} from "../src/shared/mail-index-progress";

describe("mail index progress view", () => {
  it("reports running, paused, and failed lifecycle states safely", () => {
    expect(toMailIndexDescription({ status: "running" })).toBe(
      "Downloading and indexing your mail…"
    );
    expect(toMailIndexDescription({ status: "paused" })).toBe(
      "Mail sync is paused until this account is reconnected."
    );
    expect(toMailIndexDescription({ status: "failed" })).toBe(
      "Mail sync stopped. Select Sync now to try again."
    );
    expect(toMailIndexDescription({ status: "complete" })).toBe(
      "Kisa keeps this account's mail downloaded, searchable, and up to date on its own."
    );
  });

  it("reports current-run email progress and weights accounts by email total", () => {
    expect(
      toMailIndexRatio({
        estimatedMessages: 400,
        indexedMessages: 100,
      })
    ).toBe(0.25);
    expect(
      toOverallMailIndexRatio([
        { estimatedMessages: 900, indexedMessages: 450 },
        { estimatedMessages: 100, indexedMessages: 100 },
      ])
    ).toBe(0.55);
    expect(
      toMailIndexRatio({ estimatedMessages: 100, indexedMessages: 120 })
    ).toBe(1);
  });

  it("keeps email progress indeterminate until every total is known", () => {
    expect(
      toMailIndexRatio({ estimatedMessages: 0, indexedMessages: 18_000 })
    ).toBeUndefined();
    expect(
      toOverallMailIndexRatio([
        { estimatedMessages: 100, indexedMessages: 50 },
        { indexedMessages: 10 },
      ])
    ).toBeUndefined();
  });
});
