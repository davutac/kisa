import { describe, expect, it } from "vitest";

import {
  createEmailDocument,
  neutralizeLinkElements,
} from "@/mail/email-frame";

describe(neutralizeLinkElements, () => {
  it("turns every spelling of a link start tag into an inert element", () => {
    expect(
      neutralizeLinkElements(
        '<link rel="dns-prefetch" href="//a.example">' +
          "<LINK REL=preconnect HREF=https://b.example>" +
          '<link\nrel="prefetch" href="https://c.example">' +
          "<link/rel=icon/href=https://d.example>" +
          "<link>"
      )
    ).toBe(
      '<wbr rel="dns-prefetch" href="//a.example">' +
        "<wbr REL=preconnect HREF=https://b.example>" +
        '<wbr\nrel="prefetch" href="https://c.example">' +
        "<wbr/rel=icon/href=https://d.example>" +
        "<wbr>"
    );
  });

  it("leaves other tags and text about links alone", () => {
    const html =
      '<linked-data></linked-data><a href="https://e.example">link</a>' +
      "<p>&lt;link&gt; is text</p>";

    expect(neutralizeLinkElements(html)).toBe(html);
  });
});

describe(createEmailDocument, () => {
  it("never puts a message link element into the frame", () => {
    const document = createEmailDocument(
      '<p>Hi</p><link rel="dns-prefetch" href="https://tracker.example">',
      { allowRemoteImages: true, colorScheme: "light", lightSurface: false }
    );

    expect(document).not.toMatch(/<link/iu);
    expect(document).toContain("<p>Hi</p>");
  });
});
