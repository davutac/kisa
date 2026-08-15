import { describe, expect, it } from "vitest";

import { shouldQuitAfterAllWindowsClose } from "../src/main/app/window-lifecycle";

describe(shouldQuitAfterAllWindowsClose, () => {
  it("quits macOS after the last window closes when background mode is off", () => {
    expect(shouldQuitAfterAllWindowsClose("darwin", false)).toBeTruthy();
  });

  it("keeps macOS running after the last window closes in background mode", () => {
    expect(shouldQuitAfterAllWindowsClose("darwin", true)).toBeFalsy();
  });

  it.each(["linux", "win32"] as const)(
    "quits %s after the last window closes",
    (platform) => {
      expect(shouldQuitAfterAllWindowsClose(platform, false)).toBeTruthy();
      expect(shouldQuitAfterAllWindowsClose(platform, true)).toBeTruthy();
    }
  );
});
