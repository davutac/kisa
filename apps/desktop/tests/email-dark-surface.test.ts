// What these tests prove is the arithmetic that keeps a message readable on
// the dark card: which backgrounds are let go, and that text which could no
// longer be read is given a colour that can, in the sender's hue. A wrong
// answer hides what the sender wrote in dark on dark. Reading a message's
// styles and settling its page needs Chromium's computed styles and layout,
// which no test here has.
import { describe, expect, it } from "vitest";

import {
  blend,
  contrast,
  coveredFraction,
  DARK_CANVAS,
  isPageLikeBackground,
  parseCssColor,
  repairTextColor,
} from "@/mail/email-dark-surface";

const rgb = (r: number, g: number, b: number) => ({ b, g, r });

const BLACK = rgb(0, 0, 0);
const WHITE = rgb(255, 255, 255);
const YELLOW = rgb(255, 255, 0);

describe(parseCssColor, () => {
  it.each([
    ["rgb(0, 0, 0)", { a: 1, b: 0, g: 0, r: 0 }],
    ["rgba(255, 255, 255, 0.5)", { a: 0.5, b: 255, g: 255, r: 255 }],
    ["rgba(0, 0, 0, 0)", { a: 0, b: 0, g: 0, r: 0 }],
    ["rgb(26 13 171 / 50%)", { a: 0.5, b: 171, g: 13, r: 26 }],
  ])("reads %s", (value, color) => {
    expect(parseCssColor(value)).toStrictEqual(color);
  });

  it("leaves a colour in another space unread", () => {
    expect(parseCssColor("oklch(0.7 0.1 240)")).toBeUndefined();
    expect(parseCssColor("color(display-p3 1 0 0)")).toBeUndefined();
  });
});

describe(blend, () => {
  it("lays a see-through colour over the one under it", () => {
    expect(blend({ ...WHITE, a: 0.5 }, BLACK)).toStrictEqual(
      rgb(127.5, 127.5, 127.5)
    );
  });
});

describe(isPageLikeBackground, () => {
  it.each([
    ["white", WHITE],
    ["a light grey", rgb(245, 245, 245)],
    ["a cream", rgb(243, 240, 233)],
  ])("lets %s go, as it only stands in for the page", (_name, color) => {
    expect(isPageLikeBackground(color)).toBeTruthy();
  });

  it.each([
    ["a highlight", YELLOW],
    ["a dark band", rgb(31, 41, 51)],
    ["a brand colour", rgb(37, 99, 235)],
    ["a mid grey", rgb(128, 128, 128)],
  ])("keeps %s, which the sender chose", (_name, color) => {
    expect(isPageLikeBackground(color)).toBeFalsy();
  });
});

describe(repairTextColor, () => {
  it.each([
    ["black", BLACK],
    ["a dark grey", rgb(51, 51, 51)],
    ["a muted grey", rgb(102, 102, 102)],
    ["a link's dark blue", rgb(26, 13, 171)],
    ["a dark red", rgb(153, 0, 0)],
  ])("makes %s readable on the dark card", (_name, color) => {
    const repaired = repairTextColor(color, DARK_CANVAS);

    expect(repaired).toBeDefined();
    expect(contrast(repaired ?? color, DARK_CANVAS)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it("keeps a colour's hue while it lightens it", () => {
    const blue = repairTextColor(rgb(26, 13, 171), DARK_CANVAS);
    const red = repairTextColor(rgb(153, 0, 0), DARK_CANVAS);

    expect(blue?.b).toBeGreaterThan(Math.max(blue?.r ?? 255, blue?.g ?? 255));
    expect(red?.r).toBeGreaterThan(Math.max(red?.g ?? 255, red?.b ?? 255));
  });

  it("keeps muted text dimmer than the text beside it", () => {
    const body = repairTextColor(BLACK, DARK_CANVAS);
    const muted = repairTextColor(rgb(102, 102, 102), DARK_CANVAS);

    expect(muted?.r).toBeLessThan(body?.r ?? 0);
  });

  it("darkens text left light on a highlight the message keeps", () => {
    const repaired = repairTextColor(WHITE, YELLOW);

    expect(contrast(repaired ?? WHITE, YELLOW)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ["light text on the dark card", WHITE, DARK_CANVAS],
    ["dark text on a highlight", BLACK, YELLOW],
    ["white text on a dark band", WHITE, rgb(31, 41, 51)],
  ])("leaves %s as the sender wrote it", (_name, color, background) => {
    expect(repairTextColor(color, background)).toBeUndefined();
  });

  it("does the best a mid grey background allows", () => {
    const background = rgb(119, 119, 119);
    const repaired = repairTextColor(rgb(140, 140, 140), background);

    expect(contrast(repaired ?? background, background)).toBeGreaterThan(4);
  });
});

describe(coveredFraction, () => {
  it("counts spans that overlap once", () => {
    expect(
      coveredFraction(
        [
          [0, 100],
          [50, 150],
          [400, 450],
        ],
        1000
      )
    ).toBe(0.2);
  });

  it("covers nothing of a message with no height", () => {
    expect(coveredFraction([[0, 10]], 0)).toBe(0);
  });
});
