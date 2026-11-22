// What these tests prove is the text handed to the frame and the attributes
// left on its links. That Chromium then keeps a message off the network is
// shown by loading hostile messages in a real frame, which no test here does.
// The stand-in document implements only what `prepareEmailLinks` reads.
// oxlint-disable anti-slop/no-chained-type-assertions typescript/no-unsafe-type-assertion
import { describe, expect, it } from "vitest";

import {
  createEmailDocument,
  isParsedMessageDocument,
  neutralizeActiveElements,
  prepareEmailLinks,
} from "@/mail/email-frame";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const APP_PAGE = "file:///Applications/Kisa.app/renderer/index.html";

const fakeLink = (
  attributes: Readonly<Record<string, string>>,
  namespaceURI = HTML_NAMESPACE
) => {
  const values = new Map(Object.entries(attributes));

  return {
    attributes: () => Object.fromEntries(values),
    getAttribute: (name: string) => values.get(name) ?? null,
    namespaceURI,
    removeAttribute: (name: string) => {
      values.delete(name);
    },
    removeAttributeNS: (_namespace: string, name: string) => {
      values.delete(`xlink:${name}`);
    },
    setAttribute: (name: string, value: string) => {
      values.set(name, value);
    },
  };
};

const prepare = (
  links: readonly ReturnType<typeof fakeLink>[],
  baseURI = APP_PAGE
): void => {
  prepareEmailLinks({
    baseURI,
    querySelectorAll: () => links,
  } as unknown as Document);
};

describe(neutralizeActiveElements, () => {
  it("turns every spelling of a link start tag into an inert element", () => {
    expect(
      neutralizeActiveElements(
        '<link rel="dns-prefetch" href="//a.example">' +
          "<LINK REL=preconnect HREF=https://b.example>" +
          '<link\nrel="prefetch" href="https://c.example">' +
          "<link/rel=icon/href=https://d.example>" +
          "<link>"
      )
    ).toBe(
      '<param rel="dns-prefetch" href="//a.example">' +
        "<param REL=preconnect HREF=https://b.example>" +
        '<param\nrel="prefetch" href="https://c.example">' +
        "<param/rel=icon/href=https://d.example>" +
        "<param>"
    );
  });

  it("leaves a message no nested frame to hide a link element in", () => {
    // The nested document's markup is entity-encoded, so no scan of the
    // message finds the link element it would create.
    expect(
      neutralizeActiveElements(
        '<iframe srcdoc="&lt;link rel=dns-prefetch href=//a.example&gt;"></iframe>' +
          "<IFRAME\tsrc=https://b.example>fallback</IFRAME>" +
          "<iframe/src=about:blank>"
      )
    ).toBe(
      '<param srcdoc="&lt;link rel=dns-prefetch href=//a.example&gt;"></iframe>' +
        "<param\tsrc=https://b.example>fallback</IFRAME>" +
        "<param/src=about:blank>"
    );
  });

  it("leaves a message no meta element to change the frame's rules with", () => {
    expect(
      neutralizeActiveElements(
        '<meta name="referrer" content="unsafe-url">' +
          '<META HTTP-EQUIV="refresh" CONTENT="0;url=https://a.example">' +
          '<meta\nhttp-equiv="x-dns-prefetch-control" content="on">'
      )
    ).toBe(
      '<param name="referrer" content="unsafe-url">' +
        '<param HTTP-EQUIV="refresh" CONTENT="0;url=https://a.example">' +
        '<param\nhttp-equiv="x-dns-prefetch-control" content="on">'
    );
  });

  it("renames a tag where removing it would join the rest into a new one", () => {
    expect(
      neutralizeActiveElements("<<meta>link rel=dns-prefetch href=//a.example>")
    ).toBe("<<param>link rel=dns-prefetch href=//a.example>");
  });

  it("leaves other tags and text about these elements alone", () => {
    const html =
      '<linked-data></linked-data><a href="https://e.example">link</a>' +
      "<p>&lt;link&gt; and &lt;iframe&gt; are text</p>" +
      "<metadata></metadata><iframes></iframes><meter></meter>";

    expect(neutralizeActiveElements(html)).toBe(html);
  });

  it("scans a long run of look-alike tags in linear time", () => {
    const html = "<iframe<link<meta".repeat(200_000);
    const started = performance.now();

    expect(neutralizeActiveElements(html)).toBe(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

const DOCUMENT_OPTIONS = {
  allowRemoteImages: true,
  colorScheme: "light",
  lightSurface: false,
} as const;

const policyOf = (allowRemoteImages: boolean): string =>
  /http-equiv="Content-Security-Policy" content="(?<policy>[^"]*)"/u.exec(
    createEmailDocument("", { ...DOCUMENT_OPTIONS, allowRemoteImages })
  )?.groups?.policy ?? "";

describe(createEmailDocument, () => {
  it("never puts a message's link, meta or iframe element into the frame", () => {
    const document = createEmailDocument(
      '<p>Hi</p><link rel="dns-prefetch" href="https://tracker.example">' +
        '<meta name="referrer" content="unsafe-url">' +
        '<iframe srcdoc="&lt;link rel=dns-prefetch href=//tracker.example&gt;"></iframe>',
      DOCUMENT_OPTIONS
    );
    const [, message = ""] = document.split("<body>");

    expect(message).not.toMatch(/<(?:link|meta|iframe)[\s/>]/iu);
    expect(message).toContain("<p>Hi</p>");
  });

  it("declares its own rules before any of the message is parsed", () => {
    const document = createEmailDocument(
      '<base target="_self"><p>Hi</p>',
      DOCUMENT_OPTIONS
    );
    const [head = ""] = document.split("<body>");

    expect(head).toContain('<meta name="referrer" content="no-referrer">');
    // The first `<base target>` in a document is the one that counts.
    expect(head).toContain('<base target="_blank">');
    expect(head).toContain("default-src 'none'");
  });

  it("lets images load over https only once the reader allows them", () => {
    expect(policyOf(false)).toContain("img-src data: cid:;");
    expect(policyOf(true)).toContain("img-src data: cid: https:;");
    expect(policyOf(true)).not.toMatch(/img-src[^;]*\shttp:/u);
  });
});

describe(prepareEmailLinks, () => {
  it("sends web links to a new window and strips what else a click could do", () => {
    const link = fakeLink({
      download: "",
      href: "https://example.com/page",
      ping: "https://tracker.example/click",
      target: "_self",
    });
    const area = fakeLink({ href: "http://example.com/map" });

    prepare([link, area]);

    expect(link.attributes()).toStrictEqual({
      href: "https://example.com/page",
      referrerpolicy: "no-referrer",
      rel: "noopener noreferrer",
      target: "_blank",
    });
    expect(area.attributes()).toStrictEqual({
      href: "http://example.com/map",
      referrerpolicy: "no-referrer",
      rel: "noopener noreferrer",
      target: "_blank",
    });
  });

  it.each([
    "file:///etc/hosts",
    // oxlint-disable-next-line eslint/no-script-url -- A script link is one of the destinations a message must not keep.
    "javascript:alert(1)",
    "data:text/html,<p>x</p>",
    "smb://server/share",
    "vscode://file/etc/hosts",
    "mailto:someone@example.com",
    // Relative to Kisa's own page, which no message should reach.
    "index.html#/settings",
    "#top",
    "https://",
  ])("disarms a link to %s", (href) => {
    const link = fakeLink({ href, target: "_blank" });

    prepare([link]);

    expect(link.attributes()).toStrictEqual({});
  });

  it("disarms svg links, which cannot be pointed at a new window", () => {
    const link = fakeLink(
      { href: "https://example.com/", "xlink:href": "https://example.com/" },
      SVG_NAMESPACE
    );

    prepare([link]);

    expect(link.attributes()).toStrictEqual({});
  });

  it("resolves a relative link against the base the message declared", () => {
    const link = fakeLink({ href: "/article" });

    prepare([link], "https://news.example/issue/1");

    expect(link.attributes().href).toBe("https://news.example/article");
  });

  it("leaves an anchor without a destination alone", () => {
    const anchor = fakeLink({ name: "top" });

    prepare([anchor]);

    expect(anchor.attributes()).toStrictEqual({ name: "top" });
  });
});

describe(isParsedMessageDocument, () => {
  const previous = { URL: "about:srcdoc", readyState: "complete" } as const;

  it("waits while the frame still holds the document being replaced", () => {
    expect(isParsedMessageDocument(previous, previous)).toBeFalsy();
    expect(isParsedMessageDocument(null, previous)).toBeFalsy();
  });

  it("waits for the frame's first empty page to give way to the message", () => {
    expect(
      isParsedMessageDocument(
        { URL: "about:blank", readyState: "complete" },
        null
      )
    ).toBeFalsy();
  });

  it("waits until the message is parsed, not until its images have loaded", () => {
    expect(
      isParsedMessageDocument(
        { URL: "about:srcdoc", readyState: "loading" },
        previous
      )
    ).toBeFalsy();
    expect(
      isParsedMessageDocument(
        { URL: "about:srcdoc", readyState: "interactive" },
        previous
      )
    ).toBeTruthy();
    expect(
      isParsedMessageDocument(
        { URL: "about:srcdoc", readyState: "complete" },
        previous
      )
    ).toBeTruthy();
  });
});
