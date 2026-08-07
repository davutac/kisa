import { describe, expect, it } from "vitest";

import { blockRemoteImages, containsRemoteImages } from "@/mail/remote-images";

describe(blockRemoteImages, () => {
  it("strips remote image sources", () => {
    const result = blockRemoteImages(
      '<p>Hi</p><img alt="Logo" src="https://tracker.example/pixel.gif" width="1">'
    );

    expect(result.hasRemoteImages).toBeTruthy();
    expect(result.html).toBe('<p>Hi</p><img alt="Logo" width="1">');
  });

  it("strips protocol relative and unquoted sources", () => {
    expect(blockRemoteImages('<img src="//cdn.example/a.png">').html).toBe(
      "<img>"
    );
    expect(blockRemoteImages("<img src=http://cdn.example/a.png>").html).toBe(
      "<img>"
    );
  });

  it("strips source sets, posters and background attributes", () => {
    const result = blockRemoteImages(
      '<source srcset="https://cdn.example/a.png 1x, https://cdn.example/b.png 2x">' +
        '<video poster="https://cdn.example/poster.jpg"></video>' +
        '<td background="https://cdn.example/tile.png">Cell</td>'
    );

    expect(result.hasRemoteImages).toBeTruthy();
    expect(result.html).toBe("<source><video></video><td>Cell</td>");
  });

  it("neutralises remote urls in inline styles and style blocks", () => {
    const result = blockRemoteImages(
      '<style>.hero { background-image: url("https://cdn.example/hero.png"); }</style>' +
        "<div style=\"background: url('https://cdn.example/tile.png') repeat\"></div>"
    );

    expect(result.hasRemoteImages).toBeTruthy();
    expect(result.html).toBe(
      "<style>.hero { background-image: url(about:blank); }</style>" +
        '<div style="background: url(about:blank) repeat"></div>'
    );
  });

  it("keeps embedded and attached images", () => {
    const html =
      '<img src="cid:logo@example"><img src="data:image/png;base64,AAAA">' +
      '<div style="background-image: url(data:image/gif;base64,AA)"></div>';
    const result = blockRemoteImages(html);

    expect(result.hasRemoteImages).toBeFalsy();
    expect(result.html).toBe(html);
  });

  it("leaves lookalike attributes alone", () => {
    const html =
      '<img data-src="https://cdn.example/a.png" alt="src=https://x.example">' +
      '<a href="https://example.com">Link</a>';
    const result = blockRemoteImages(html);

    expect(result.hasRemoteImages).toBeFalsy();
    expect(result.html).toBe(html);
  });

  it("does not treat scripts and frames as images", () => {
    const html = '<script src="https://cdn.example/a.js"></script>';

    expect(blockRemoteImages(html).hasRemoteImages).toBeFalsy();
  });
});

describe(containsRemoteImages, () => {
  it("reports plain text bodies as free of remote images", () => {
    expect(containsRemoteImages()).toBeFalsy();
    expect(containsRemoteImages("<p>No pictures here</p>")).toBeFalsy();
    expect(
      containsRemoteImages('<img src="https://a.example/b.png">')
    ).toBeTruthy();
  });
});
