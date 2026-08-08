const BADGE_SIZE = 16;
const MAX_WINDOWS_BADGE_COUNT = 99;
const DIGIT_HEIGHT = 5;
const DIGIT_WIDTH = 3;
const DIGIT_GAP = 1;
const DIGIT_SCALE = 2;

const DIGITS: Readonly<Record<string, readonly string[]>> = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
};

interface BadgeCountTarget {
  readonly setBadgeCount: (count: number) => boolean;
}

interface BadgeWindowTarget<Overlay> {
  readonly setOverlayIcon: (
    overlay: Overlay | null,
    description: string
  ) => void;
}

interface UpdateUnreadBadgeOptions<Overlay> {
  readonly app: BadgeCountTarget;
  readonly count: number;
  readonly createOverlay: (count: number) => Overlay;
  readonly platform: NodeJS.Platform;
  readonly windows: readonly BadgeWindowTarget<Overlay>[];
}

const normalizeCount = (count: number): number =>
  Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

export const formatUnreadBadgeDescription = (count: number): string =>
  `${count} unread ${count === 1 ? "email" : "emails"}`;

/**
 * Applies the count to the native surface each desktop exposes. Electron owns
 * the numbered badge on macOS and supported Linux launchers; Windows exposes a
 * taskbar overlay image instead.
 */
export const updateUnreadBadge = <Overlay>({
  app,
  count,
  createOverlay,
  platform,
  windows,
}: UpdateUnreadBadgeOptions<Overlay>): void => {
  const normalizedCount = normalizeCount(count);

  if (platform === "darwin" || platform === "linux") {
    app.setBadgeCount(normalizedCount);
    return;
  }

  if (platform !== "win32") {
    return;
  }

  const overlay = normalizedCount === 0 ? null : createOverlay(normalizedCount);
  const description =
    normalizedCount === 0
      ? "No unread emails"
      : formatUnreadBadgeDescription(normalizedCount);

  for (const window of windows) {
    window.setOverlayIcon(overlay, description);
  }
};

const setPixel = (
  bitmap: Buffer,
  x: number,
  y: number,
  blue: number,
  green: number,
  red: number,
  alpha: number
): void => {
  const offset = (y * BADGE_SIZE + x) * 4;

  bitmap[offset] = blue;
  bitmap[offset + 1] = green;
  bitmap[offset + 2] = red;
  bitmap[offset + 3] = alpha;
};

/** Creates the 16px BGRA bitmap used for Windows' taskbar overlay icon. */
export const createUnreadBadgeBitmap = (count: number): Buffer => {
  const bitmap = Buffer.alloc(BADGE_SIZE * BADGE_SIZE * 4);
  const center = (BADGE_SIZE - 1) / 2;
  const radius = BADGE_SIZE / 2;

  for (let y = 0; y < BADGE_SIZE; y += 1) {
    for (let x = 0; x < BADGE_SIZE; x += 1) {
      const distanceSquared = (x - center) ** 2 + (y - center) ** 2;

      if (distanceSquared <= radius ** 2) {
        // BGRA for a conventional notification red.
        setPixel(bitmap, x, y, 77, 72, 229, 255);
      }
    }
  }

  const label = String(
    Math.min(MAX_WINDOWS_BADGE_COUNT, Math.max(1, Math.trunc(count)))
  );
  const labelWidth =
    (label.length * DIGIT_WIDTH + (label.length - 1) * DIGIT_GAP) * DIGIT_SCALE;
  const startX = Math.floor((BADGE_SIZE - labelWidth) / 2);
  const startY = Math.floor((BADGE_SIZE - DIGIT_HEIGHT * DIGIT_SCALE) / 2);

  for (const [digitIndex, digit] of [...label].entries()) {
    const glyph = DIGITS[digit];

    if (glyph === undefined) {
      continue;
    }

    for (const [rowIndex, row] of glyph.entries()) {
      for (const [columnIndex, cell] of [...row].entries()) {
        if (cell !== "1") {
          continue;
        }

        const glyphX =
          startX +
          (digitIndex * (DIGIT_WIDTH + DIGIT_GAP) + columnIndex) * DIGIT_SCALE;
        const glyphY = startY + rowIndex * DIGIT_SCALE;

        for (let offsetY = 0; offsetY < DIGIT_SCALE; offsetY += 1) {
          for (let offsetX = 0; offsetX < DIGIT_SCALE; offsetX += 1) {
            setPixel(
              bitmap,
              glyphX + offsetX,
              glyphY + offsetY,
              255,
              255,
              255,
              255
            );
          }
        }
      }
    }
  }

  return bitmap;
};
