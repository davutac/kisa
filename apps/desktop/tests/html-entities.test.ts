import { describe, expect, it } from "vitest";

import {
  decodeGmailSnippet,
  decodeHtmlEntities,
} from "../src/main/mail/html-entities";

describe(decodeGmailSnippet, () => {
  it("turns Gmail's escaped snippet back into the text people wrote", () => {
    expect(
      decodeGmailSnippet(
        "it&#39;s &quot;fine&quot; — Davut &lt;davut@example.com&gt; &amp; co"
      )
    ).toBe('it\'s "fine" — Davut <davut@example.com> & co');
  });

  it("decodes each entity once, so escaped entity text stays literal", () => {
    expect(decodeGmailSnippet("write &amp;lt; or &#38;lt; for <")).toBe(
      "write &lt; or &lt; for <"
    );
  });
});

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
