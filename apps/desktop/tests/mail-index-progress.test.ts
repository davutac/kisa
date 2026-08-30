import { describe, expect, it } from "vitest";

import {
  getNativeMailIndexProgress,
  HIDDEN_MAIL_INDEX_PROGRESS,
  INDETERMINATE_MAIL_INDEX_PROGRESS,
} from "../src/main/app/mail-index-progress";
import type { GmailIndexProgress } from "../src/shared/ipc/mail";

const progress = (
  patch: Partial<GmailIndexProgress> = {}
): GmailIndexProgress => ({
  accountId: "person@example.com",
  indexedMessages: 0,
  indexedThreads: 0,
  status: "running",
  ...patch,
});

describe(getNativeMailIndexProgress, () => {
  it("hides the indicator when no account is indexing", () => {
    expect(getNativeMailIndexProgress([])).toBe(HIDDEN_MAIL_INDEX_PROGRESS);
    expect(
      getNativeMailIndexProgress([
        progress({ estimatedThreads: 100, status: "complete" }),
      ])
    ).toBe(HIDDEN_MAIL_INDEX_PROGRESS);
  });

  it("shows indeterminate progress until every active estimate is known", () => {
    expect(getNativeMailIndexProgress([progress()])).toBe(
      INDETERMINATE_MAIL_INDEX_PROGRESS
    );
    expect(
      getNativeMailIndexProgress([
        progress({ estimatedThreads: 0, indexedThreads: 18_000 }),
      ])
    ).toBe(INDETERMINATE_MAIL_INDEX_PROGRESS);
    expect(
      getNativeMailIndexProgress([
        progress({ estimatedThreads: 100 }),
        progress({ accountId: "other@example.com", status: "queued" }),
      ])
    ).toBe(INDETERMINATE_MAIL_INDEX_PROGRESS);
  });

  it("weights active accounts by their estimated thread totals", () => {
    expect(
      getNativeMailIndexProgress([
        progress({ estimatedThreads: 200, indexedThreads: 100 }),
        progress({
          accountId: "other@example.com",
          estimatedThreads: 100,
          indexedThreads: 50,
          status: "queued",
        }),
      ])
    ).toBe(0.5);
  });

  it("clamps an account whose Gmail estimate is lower than its index", () => {
    expect(
      getNativeMailIndexProgress([
        progress({ estimatedThreads: 100, indexedThreads: 120 }),
      ])
    ).toBe(1);
  });
});
