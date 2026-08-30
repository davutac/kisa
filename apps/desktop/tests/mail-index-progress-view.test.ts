import { describe, expect, it } from "vitest";

import { toMailIndexDescription } from "../src/renderer/src/mail/mail-index-progress-view";
import {
  toMailIndexRatio,
  toOverallMailIndexRatio,
} from "../src/shared/mail-index-progress";

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
