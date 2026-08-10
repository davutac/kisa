import { describe, expect, it } from "@effect/vitest";

import { getDatabasePath } from "../src/main/database-path";

describe(getDatabasePath, () => {
  it("uses an isolated database in development", () => {
    expect(
      getDatabasePath({
        isDevelopment: true,
        userDataPath: "/test/user-data",
      })
    ).toBe("/test/user-data/database/app.dev.sqlite");
  });

  it("preserves the production database path", () => {
    expect(
      getDatabasePath({
        isDevelopment: false,
        userDataPath: "/test/user-data",
      })
    ).toBe("/test/user-data/database/app.sqlite");
  });
});
