import { describe, expect, it } from "vitest";

import { sidebarWidthForKey } from "../src/renderer/src/components/shell/sidebar/sidebar-frame";
import { MAX_SIDEBAR_WIDTH } from "../src/renderer/src/components/shell/sidebar/sidebar-preferences";

const MEASURED_MIN = 214;

describe("sidebar resize handle keys", () => {
  it("steps the width with the arrow keys", () => {
    expect(sidebarWidthForKey("ArrowRight", 240, MEASURED_MIN)).toBe(256);
    expect(sidebarWidthForKey("ArrowLeft", 240, MEASURED_MIN)).toBe(224);
  });

  it("stops at the measured minimum and the maximum", () => {
    expect(sidebarWidthForKey("ArrowLeft", 220, MEASURED_MIN)).toBe(
      MEASURED_MIN
    );
    expect(sidebarWidthForKey("ArrowRight", MAX_SIDEBAR_WIDTH - 4, 214)).toBe(
      MAX_SIDEBAR_WIDTH
    );
  });

  it("jumps to either end with Home and End", () => {
    expect(sidebarWidthForKey("Home", 300, MEASURED_MIN)).toBe(MEASURED_MIN);
    expect(sidebarWidthForKey("End", 240, MEASURED_MIN)).toBe(
      MAX_SIDEBAR_WIDTH
    );
  });

  it("leaves every other key to the rest of the window", () => {
    expect(sidebarWidthForKey("ArrowDown", 240, MEASURED_MIN)).toBeUndefined();
    expect(sidebarWidthForKey("j", 240, MEASURED_MIN)).toBeUndefined();
  });
});
