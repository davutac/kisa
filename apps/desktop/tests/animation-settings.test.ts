import { describe, expect, it } from "vitest";

import { shouldReduceMotion } from "../src/renderer/src/lib/motion";

describe("animations setting", () => {
  it("keeps motion when animations are enabled and the OS does not prefer reduced motion", () => {
    expect(shouldReduceMotion(true, false)).toBeFalsy();
  });

  it("still honors the operating system's reduced-motion preference", () => {
    expect(shouldReduceMotion(true, true)).toBeTruthy();
  });

  it("suppresses motion when animations are disabled", () => {
    expect(shouldReduceMotion(false, false)).toBeTruthy();
    expect(shouldReduceMotion(false, true)).toBeTruthy();
  });
});
