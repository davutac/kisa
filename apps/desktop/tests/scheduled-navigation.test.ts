import { afterEach, describe, expect, it } from "vitest";

import { useScheduledMailNavigation } from "../src/renderer/src/scheduled/scheduled-navigation";

describe("scheduled mail navigation", () => {
  afterEach(() => {
    useScheduledMailNavigation.getState().clear();
  });

  it("keeps an account-scoped editor target queued until it is cleared", () => {
    const target = {
      accountId: "person@example.com",
      draftId: "draft-1",
    };

    useScheduledMailNavigation.getState().requestOpen(target);
    expect(useScheduledMailNavigation.getState().target).toStrictEqual(target);

    useScheduledMailNavigation.getState().clear();
    expect(useScheduledMailNavigation.getState().target).toBeNull();
  });
});
