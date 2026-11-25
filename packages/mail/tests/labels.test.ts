import { describe, expect, it } from "vitest";

import { toLabelPath } from "../src/labels";

describe("label names", () => {
  it("nests with slashes and uses the server's separator in the path", () => {
    expect(toLabelPath(" Trips / 2026 ", ".")).toStrictEqual({
      name: "Trips/2026",
      path: "Trips.2026",
    });
    expect(toLabelPath("Trips/2026", "/")).toStrictEqual({
      name: "Trips/2026",
      path: "Trips/2026",
    });
  });

  it("refuses names the mailbox list would misread", () => {
    for (const name of [
      "",
      "a//b",
      "INBOX",
      "Spam/x",
      "line\nbreak",
      "x".repeat(201),
    ]) {
      expect(toLabelPath(name, "/")).toBeUndefined();
    }

    expect(toLabelPath("v1.2", ".")).toBeUndefined();
  });
});
