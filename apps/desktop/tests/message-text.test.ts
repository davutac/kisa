import { describe, expect, it } from "vitest";

import { toIndexText } from "../src/main/mail/message-text";

describe(toIndexText, () => {
  it("drops tags and collapses whitespace", () => {
    expect(toIndexText('<div class="x">  Hello   world  </div>')).toBe(
      "Hello world"
    );
  });

  it("keeps block boundaries as word breaks", () => {
    // Without this, the two paragraphs would index as one unsearchable token.
    expect(toIndexText("<p>invoice</p><p>attached</p>")).toBe(
      "invoice attached"
    );
    expect(toIndexText("one<br>two")).toBe("one two");
  });

  it("removes script and style content entirely", () => {
    expect(
      toIndexText(
        "<style>.a{color:red}</style><p>real</p><script>alert(1)</script>"
      )
    ).toBe("real");
  });

  it("strips comments, including conditional wrappers", () => {
    expect(toIndexText("<!-- hidden note -->visible")).toBe("visible");
    expect(toIndexText("<!--[if mso]><p>outlook</p><![endif]-->visible")).toBe(
      "visible"
    );
  });

  it("decodes the entities that survive into indexed text", () => {
    expect(toIndexText("Ben &amp; Jerry&apos;s")).toBe("Ben & Jerry's");
    expect(toIndexText("caf&#233; &#x2014; open")).toBe("café — open");
    expect(toIndexText("a&nbsp;b")).toBe("a b");
  });

  it("leaves unknown entities alone rather than mangling them", () => {
    expect(toIndexText("&notarealentity; x")).toBe("&notarealentity; x");
  });

  it("ignores out-of-range numeric entities", () => {
    expect(toIndexText("&#0; &#1114112;")).toBe("&#0; &#1114112;");
  });

  it("returns an empty string for markup with no text", () => {
    expect(toIndexText("<div><span></span></div>")).toBe("");
  });

  it("keeps the text of unclosed elements and comments", () => {
    expect(toIndexText("<p>kept</p><style>.a{}")).toBe("kept .a{}");
    expect(toIndexText("<p>kept</p><!-- open")).toBe("kept <!-- open");
    expect(toIndexText("<p>kept</p><img src=x")).toBe("kept <img src=x");
  });

  it("removes a style that follows an unclosed script", () => {
    expect(toIndexText("<script>a<style>b</style><p>c</p>")).toBe("a c");
  });

  // Each of these held Electron main for seconds with the previous patterns.
  // A synchronous regex cannot be interrupted by the test timeout, so the
  // bound is asserted directly.
  it.each([
    ["unclosed comments", "<!--".repeat(32_768)],
    ["unclosed styles", "<style>".repeat(65_536)],
    ["unclosed tags", "<".repeat(65_536)],
    // Removing the comment also removes the last `>`.
    ["unclosed tags before a comment", `${"<".repeat(65_536)}<!---->`],
  ])("flattens %s in linear time", (_label, html) => {
    const start = performance.now();
    toIndexText(html);

    expect(performance.now() - start).toBeLessThan(500);
  });
});
