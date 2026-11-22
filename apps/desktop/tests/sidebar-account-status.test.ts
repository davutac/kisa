import { describe, expect, it } from "vitest";

import { getAccountRowStatus } from "../src/renderer/src/components/shell/sidebar/sidebar-account-row";

describe(getAccountRowStatus, () => {
  it("shows an account whose sign-in was refused in place of its progress", () => {
    expect(
      getAccountRowStatus({ indexStatus: "paused", isSyncing: false })
    ).toBe("needs-sign-in");
  });

  // Each try to sign in again is a sync, and shows as one.
  it("shows a sync over everything else", () => {
    expect(
      getAccountRowStatus({ indexStatus: "paused", isSyncing: true })
    ).toBe("syncing");
  });

  it("shows indexing only while the index runs", () => {
    expect(
      getAccountRowStatus({ indexStatus: "running", isSyncing: false })
    ).toBe("indexing");
    expect(
      getAccountRowStatus({ indexStatus: "complete", isSyncing: false })
    ).toBe("idle");
    expect(
      getAccountRowStatus({ indexStatus: undefined, isSyncing: false })
    ).toBe("idle");
  });
});
