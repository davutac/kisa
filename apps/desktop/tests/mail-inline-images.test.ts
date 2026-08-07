import { describe, expect, it } from "vitest";

import {
  collectReferencedContentIds,
  inlineImageDataUrls,
  selectInlineImages,
  toImageDataUrl,
} from "../src/main/mail/inline-images";

const logo = {
  contentId: "logo@proroba.de",
  mediaType: "image/png",
  size: 4096,
};

describe(collectReferencedContentIds, () => {
  it("finds content ids in sources and style urls", () => {
    const contentIds = collectReferencedContentIds(
      '<img src="cid:logo@proroba.de">' +
        "<div style=\"background-image: url('cid:Banner@Example')\"></div>"
    );

    expect([...contentIds]).toStrictEqual([
      "logo@proroba.de",
      "banner@example",
    ]);
  });

  it("decodes percent encoded content ids", () => {
    expect([
      ...collectReferencedContentIds('<img src="cid:logo%40example.de">'),
    ]).toStrictEqual(["logo@example.de"]);
  });
});

describe(selectInlineImages, () => {
  const html = '<img src="cid:logo@proroba.de">';

  it("picks the images the body points at", () => {
    const unused = {
      contentId: "unused@example",
      mediaType: "image/png",
      size: 512,
    };

    expect(selectInlineImages(html, [logo, unused])).toStrictEqual([logo]);
  });

  it("ignores attachments without a content id or with a foreign one", () => {
    const plain = { mediaType: "image/png", size: 512 };

    expect(selectInlineImages(html, [plain])).toStrictEqual([]);
  });

  it("ignores parts that are not images", () => {
    const document = {
      contentId: "logo@proroba.de",
      mediaType: "application/pdf",
      size: 512,
    };

    expect(selectInlineImages(html, [document])).toStrictEqual([]);
  });

  it("skips images too large to travel as text", () => {
    const huge = { ...logo, size: 4 * 1024 * 1024 };

    expect(selectInlineImages(html, [huge])).toStrictEqual([]);
  });

  it("stops once the message budget is spent", () => {
    const body = Array.from(
      { length: 6 },
      (_unused, index) => `<img src="cid:part-${index}@example">`
    ).join("");
    const attachments = Array.from({ length: 6 }, (_unused, index) => ({
      contentId: `part-${index}@example`,
      mediaType: "image/jpeg",
      size: 2 * 1024 * 1024,
    }));

    expect(selectInlineImages(body, attachments)).toHaveLength(4);
  });

  it("does not look at attachments when the body has no references", () => {
    expect(selectInlineImages("<p>Plain</p>", [logo])).toStrictEqual([]);
  });
});

describe(toImageDataUrl, () => {
  it("encodes image bytes", () => {
    expect(toImageDataUrl("image/png", Uint8Array.from([1, 2, 3]))).toBe(
      "data:image/png;base64,AQID"
    );
  });

  it("refuses media types that are not images", () => {
    expect(toImageDataUrl("text/html", Uint8Array.from([1]))).toBeUndefined();
  });
});

describe(inlineImageDataUrls, () => {
  it("points sources and style urls at the fetched bytes", () => {
    const html =
      '<img src="cid:logo@proroba.de">' +
      "<div style=\"background: url('cid:LOGO@proroba.de')\"></div>";
    const dataUrls = new Map([["logo@proroba.de", "data:image/png;base64,AQ"]]);

    expect(inlineImageDataUrls(html, dataUrls)).toBe(
      '<img src="data:image/png;base64,AQ">' +
        "<div style=\"background: url('data:image/png;base64,AQ')\"></div>"
    );
  });

  it("leaves references it could not fetch alone", () => {
    const html = '<img src="cid:missing@example">';

    expect(
      inlineImageDataUrls(html, new Map([["other@example", "data:image/png"]]))
    ).toBe(html);
  });
});
