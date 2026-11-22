// oxlint-disable vitest/prefer-import-in-mock
import { describe, expect, it, vi } from "vitest";

import { toMicrosoftClientId } from "../src/main/auth/microsoft-client";

vi.mock("electron", () => ({ net: {}, shell: {} }));

describe(toMicrosoftClientId, () => {
  it("takes an Application (client) ID as the build set it", () => {
    expect(toMicrosoftClientId(" 0A1B2C3D-4e5f-4a7b-8c9d-0e1f2a3b4c5d\n")).toBe(
      "0A1B2C3D-4e5f-4a7b-8c9d-0e1f2a3b4c5d"
    );
  });

  it.each([
    ["no setting", undefined],
    ["an empty setting", ""],
    ["something that is not an ID", "my-client"],
    ["an ID with more in it", "0a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d&x=1"],
  ])("offers no Microsoft sign-in for %s", (_name, configured) => {
    expect(toMicrosoftClientId(configured)).toBeUndefined();
  });
});
