import { describe, expect, it } from "vitest";

import { decodeHtmlEntities } from "../src/main/mail/html-entities";

describe(decodeHtmlEntities, () => {
  it("reads decimal and hex code points and leaves unknown or invalid ones", () => {
    expect(
      decodeHtmlEntities("&#8217; &#x1F600; &unknown; &#0; &#x110000;")
    ).toBe("’ 😀 &unknown; &#0; &#x110000;");
  });

  it("keeps decimal entities decimal and refuses surrogate halves", () => {
    expect(decodeHtmlEntities("&#1e1; &#xD800; &#X41; &#65;")).toBe(
      "&#1e1; &#xD800; A A"
    );
  });
});
