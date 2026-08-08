import { describe, expect, it, vi } from "vitest";

import {
  createUnreadBadgeBitmap,
  formatUnreadBadgeDescription,
  updateUnreadBadge,
} from "../src/main/app/unread-badge";

describe(updateUnreadBadge, () => {
  it.each(["darwin", "linux"] as const)(
    "uses Electron's native numeric badge on %s",
    (platform) => {
      const setBadgeCount = vi.fn<(count: number) => boolean>(() => true);
      const setOverlayIcon =
        vi.fn<(overlay: string | null, description: string) => void>();

      updateUnreadBadge({
        app: { setBadgeCount },
        count: 7,
        createOverlay: () => "overlay",
        platform,
        windows: [{ setOverlayIcon }],
      });

      expect(setBadgeCount).toHaveBeenCalledWith(7);
      expect(setOverlayIcon).not.toHaveBeenCalled();
    }
  );

  it("uses a numbered overlay on every Windows taskbar window", () => {
    const setOverlayIcon =
      vi.fn<(overlay: string | null, description: string) => void>();

    updateUnreadBadge({
      app: {
        setBadgeCount: vi.fn<(count: number) => boolean>(() => false),
      },
      count: 12,
      createOverlay: (count) => `overlay-${count}`,
      platform: "win32",
      windows: [{ setOverlayIcon }, { setOverlayIcon }],
    });

    expect(setOverlayIcon).toHaveBeenCalledTimes(2);
    expect(setOverlayIcon).toHaveBeenCalledWith(
      "overlay-12",
      "12 unread emails"
    );
  });

  it("clears a Windows overlay and clamps invalid native counts", () => {
    const setBadgeCount = vi.fn<(count: number) => boolean>(() => true);
    const setOverlayIcon =
      vi.fn<(overlay: string | null, description: string) => void>();
    const createOverlay = vi.fn<(count: number) => string>(() => "overlay");

    updateUnreadBadge({
      app: { setBadgeCount },
      count: 0,
      createOverlay,
      platform: "win32",
      windows: [{ setOverlayIcon }],
    });
    updateUnreadBadge({
      app: { setBadgeCount },
      count: Number.NaN,
      createOverlay,
      platform: "darwin",
      windows: [],
    });

    expect(setOverlayIcon).toHaveBeenCalledWith(null, "No unread emails");
    expect(createOverlay).not.toHaveBeenCalled();
    expect(setBadgeCount).toHaveBeenCalledWith(0);
  });
});

describe(createUnreadBadgeBitmap, () => {
  it("creates an opaque red badge with transparent corners and white digits", () => {
    const bitmap = createUnreadBadgeBitmap(42);
    const alphaAt = (x: number, y: number): number | undefined =>
      bitmap[(y * 16 + x) * 4 + 3];
    const hasWhitePixel = [...bitmap].some(
      (_, index) =>
        index % 4 === 0 &&
        bitmap[index] === 255 &&
        bitmap[index + 1] === 255 &&
        bitmap[index + 2] === 255 &&
        bitmap[index + 3] === 255
    );

    expect(bitmap).toHaveLength(16 * 16 * 4);
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(8, 8)).toBe(255);
    expect(hasWhitePixel).toBeTruthy();
  });
});

describe(formatUnreadBadgeDescription, () => {
  it("pluralizes its accessibility description", () => {
    expect(formatUnreadBadgeDescription(1)).toBe("1 unread email");
    expect(formatUnreadBadgeDescription(2)).toBe("2 unread emails");
  });
});
