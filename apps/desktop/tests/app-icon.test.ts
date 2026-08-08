import { describe, expect, it } from "@effect/vitest";

import { setDevelopmentDockIcon } from "../src/main/app/app-icon";

describe(setDevelopmentDockIcon, () => {
  it("sets the canonical icon on the macOS development Dock", () => {
    const icons: string[] = [];

    setDevelopmentDockIcon({
      dock: { setIcon: (icon) => icons.push(icon) },
      icon: "/build/icon.png",
      isDevelopment: true,
      platform: "darwin",
    });

    expect(icons).toStrictEqual(["/build/icon.png"]);
  });

  it("leaves packaged and non-macOS Dock icons alone", () => {
    const icons: string[] = [];
    const dock = { setIcon: (icon: string) => icons.push(icon) };

    setDevelopmentDockIcon({
      dock,
      icon: "/build/icon.png",
      isDevelopment: false,
      platform: "darwin",
    });
    setDevelopmentDockIcon({
      dock,
      icon: "/build/icon.png",
      isDevelopment: true,
      platform: "linux",
    });

    expect(icons).toStrictEqual([]);
  });
});
