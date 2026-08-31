import { describe, expect, it } from "vitest";

import { getScheduledTitlebarAccountIds } from "../src/renderer/src/scheduled/use-scheduled-titlebar-state";

describe("Scheduled titlebar state", () => {
  it("checks every connected account for scheduled mail", () => {
    expect(
      getScheduledTitlebarAccountIds([
        { email: "selected@example.com" },
        { email: "other@example.com" },
      ])
    ).toStrictEqual(["selected@example.com", "other@example.com"]);
  });
});
