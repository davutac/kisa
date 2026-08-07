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
});
