/**
 * Label colours are Kisa's own: neither IMAP nor Gmail's IMAP extensions carry
 * them. A label stores only its background; the text colour is derived from
 * it, so every label stays readable whatever background it holds.
 */
export const LABEL_COLOR_PATTERN = /^#[0-9a-f]{6}$/u;

export const isLabelColor = (value: string): boolean =>
  LABEL_COLOR_PATTERN.test(value);

const toLinearChannel = (value: number): number => {
  const channel = value / 255;

  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = (color: string): number =>
  0.2126 * toLinearChannel(Number.parseInt(color.slice(1, 3), 16)) +
  0.7152 * toLinearChannel(Number.parseInt(color.slice(3, 5), 16)) +
  0.0722 * toLinearChannel(Number.parseInt(color.slice(5, 7), 16));

export const contrastRatio = (left: string, right: string): number => {
  const [lighter, darker] = [
    relativeLuminance(left),
    relativeLuminance(right),
  ].toSorted((a, b) => b - a);

  return (lighter + 0.05) / (darker + 0.05);
};

// Black or white, whichever contrasts more; one of them always reaches 4.5:1.
export const labelTextColor = (background: string): "#000000" | "#ffffff" =>
  relativeLuminance(background) > 0.179 ? "#000000" : "#ffffff";

const toHex = (value: number): string =>
  Math.round(value * 255)
    .toString(16)
    .padStart(2, "0");

const hslToHex = (hue: number, saturation: number, lightness: number) => {
  const amount = saturation * Math.min(lightness, 1 - lightness);

  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;

    return lightness - amount * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };

  return `#${toHex(channel(0))}${toHex(channel(8))}${toHex(channel(4))}`;
};

const LIGHTNESS_TIERS = [0.34, 0.44, 0.72, 0.82] as const;

/* oxlint-disable eslint/no-bitwise -- a 32-bit FNV-1a hash picks the colour. */

const labelColorFromSeed = (seed: number): string =>
  hslToHex(
    seed % 360,
    0.55 + ((seed >>> 9) % 26) / 100,
    LIGHTNESS_TIERS[(seed >>> 17) % LIGHTNESS_TIERS.length] ?? 0.72
  );

/**
 * A colour that looks picked at random but is seeded by the label's
 * case-insensitive name, so a label that several accounts share gets one
 * colour and All Accounts can show it.
 */
export const seededLabelColor = (name: string): string => {
  let hash = 0x81_1c_9d_c5;

  for (const char of name.trim().toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01_00_01_93);
  }

  return labelColorFromSeed(hash >>> 0);
};

/* oxlint-enable eslint/no-bitwise */

export const randomLabelColor = (): string =>
  labelColorFromSeed(Math.floor(Math.random() * 2 ** 32));
