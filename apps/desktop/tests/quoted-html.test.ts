// @vitest-environment happy-dom
//
// What these tests prove is which part of an HTML message is cut off as the
// earlier messages it quotes, and that each is handed on as the message it
// was: a wrong cut hides what the sender wrote, or shows it under another
// sender's name. The messages are written out in the markup each client
// sends. They are parsed by happy-dom, not Chromium, so what a real frame
// then does with the parts, and that parsing one loads nothing, is not shown
// here.
import { describe, expect, it } from "vitest";

import { splitQuotedHtml } from "@/mail/quoted-html";

const JONAS = "Jonas Aalto &lt;jonas@harbor.example&gt;";
const MAYA = "Maya Lindqvist &lt;maya@fernhill.example&gt;";

const gmailQuote = (attribution: string, html: string): string =>
  `<div><br></div><div class="gmail_quote"><div dir="ltr" class="gmail_attr">${attribution}<br></div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${html}</blockquote></div>`;

const appleQuote = (attribution: string, html: string): string =>
  `<div><br><div>${attribution}</div><br class="Apple-interchange-newline"><blockquote type="cite"><div>${html}</div></blockquote></div>`;

const outlookFields = (from: string): string =>
  `<b>From:</b> ${from}<br><b>Sent:</b> Monday, 09:14<br><b>To:</b> ${JONAS}<br><b>Subject:</b> Rebrand: round two`;

const outlookWebQuote = (from: string, html: string): string =>
  `<div id="appendonsend"></div><hr style="display:inline-block;width:98%"><div id="x_divRplyFwdMsg" dir="ltr"><font face="Calibri">${outlookFields(from)}</font><div>&nbsp;</div></div>${html}`;

const outlookWindowsQuote = (from: string, html: string): string =>
  `<div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0cm 0cm 0cm"><p class="MsoNormal">${outlookFields(from)}</p></div></div><p class="MsoNormal">&nbsp;</p>${html}`;

/** The text a part shows, as one line, with a space where a block ends. */
const textOf = (html: string): string => {
  const { body } = new DOMParser().parseFromString(
    html.replaceAll(/<br>|<\/(?:p|div|blockquote)>/gu, "$& "),
    "text/html"
  );

  for (const style of body.querySelectorAll("style")) {
    style.remove();
  }

  return (body.textContent ?? "").replaceAll(/\s+/gu, " ").trim();
};

const hasElement = (html: string, selector: string): boolean =>
  new DOMParser().parseFromString(html, "text/html").querySelector(selector) !==
  null;

const split = (html: string) => {
  const result = splitQuotedHtml(html);

  if (result === null) {
    throw new Error("The message was not split");
  }

  return result;
};

describe(splitQuotedHtml, () => {
  it("cuts a Gmail quote off and hands it on unquoted", () => {
    const { html, quotes } = split(
      `<div dir="ltr">Sounds good.</div>${gmailQuote(`On Wed, Nov 26, 2026 at 12:17 PM ${JONAS} wrote:`, "<p>The team loved it.</p><p>Jonas</p>")}`
    );

    expect(textOf(html)).toBe("Sounds good.");
    expect(quotes).toHaveLength(1);
    expect(textOf(quotes[0]?.html ?? "")).toBe("The team loved it. Jonas");
    expect(hasElement(quotes[0]?.html ?? "", "blockquote")).toBeFalsy();
    expect(quotes[0]?.sender).toStrictEqual({
      attribution:
        "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@harbor.example> wrote:",
      email: "jonas@harbor.example",
      name: "Jonas Aalto",
    });
  });

  it("cuts an Apple Mail quote off with the attribution above it", () => {
    const { html, quotes } = split(
      `<div>Sounds good.</div>${appleQuote(`On Nov 26, 2026, at 12:17, ${JONAS} wrote:`, "<p>The team loved it.</p>")}`
    );

    expect(textOf(html)).toBe("Sounds good.");
    expect(textOf(quotes[0]?.html ?? "")).toBe("The team loved it.");
    expect(hasElement(quotes[0]?.html ?? "", "blockquote")).toBeFalsy();
    expect(quotes[0]?.sender.email).toBe("jonas@harbor.example");
  });

  it("cuts an Outlook on the web quote off from its header block on", () => {
    const { html, quotes } = split(
      `<div>Approved.</div>${outlookWebQuote(MAYA, "<div>Round two is attached.</div>")}`
    );

    expect(textOf(html)).toBe("Approved.");
    expect(textOf(quotes[0]?.html ?? "")).toBe("Round two is attached.");
    expect(quotes[0]?.sender).toStrictEqual({
      attribution:
        "From: Maya Lindqvist <maya@fernhill.example> · Sent: Monday, 09:14",
      email: "maya@fernhill.example",
      name: "Maya Lindqvist",
    });
  });

  it("cuts an Outlook for Windows quote off, original after the wrapper and all", () => {
    const { html, quotes } = split(
      `<p class="MsoNormal">Approved.</p>${outlookWindowsQuote(MAYA, '<p class="MsoNormal">Round two is attached.</p><p class="MsoNormal">Maya</p>')}`
    );

    expect(textOf(html)).toBe("Approved.");
    expect(textOf(quotes[0]?.html ?? "")).toBe("Round two is attached. Maya");
    expect(quotes[0]?.sender.email).toBe("maya@fernhill.example");
  });

  it("gives every part the message's styles, wherever they were written", () => {
    const { html, quotes } = split(
      `<html><head><meta charset="utf-8"><style>p.MsoNormal{margin:0}</style></head><body><p class="MsoNormal">Approved.</p><style>.late{color:red}</style>${outlookWindowsQuote(MAYA, '<p class="MsoNormal">Round two is attached.</p>')}</body></html>`
    );

    const quote = quotes[0]?.html ?? "";

    for (const part of [html, quote]) {
      expect(part).toContain("p.MsoNormal{margin:0}");
      expect(part).toContain(".late{color:red}");
    }

    // A style right above the quote is not mistaken for the quote itself.
    expect(textOf(html)).toBe("Approved.");
    expect(textOf(quote)).toBe("Round two is attached.");
  });

  it("unpacks a chain of quotes into one message each, nearest first", () => {
    const oldest = outlookWindowsQuote(MAYA, "<p>Round two is attached.</p>");

    const middle = appleQuote(
      `On Tuesday at 10:17, ${JONAS} wrote:`,
      `<p>This is a big step up.</p>${oldest}`
    );

    const { html, quotes } = split(
      `<p>The team loved it.</p>${gmailQuote(`On Wed, 13:17, ${MAYA} wrote:`, `<p>Good catch on the decaf.</p>${middle}`)}`
    );

    expect(textOf(html)).toBe("The team loved it.");
    expect(
      quotes.map((quote) => [quote.sender.email, textOf(quote.html)])
    ).toStrictEqual([
      ["maya@fernhill.example", "Good catch on the decaf."],
      ["jonas@harbor.example", "This is a big step up."],
      ["maya@fernhill.example", "Round two is attached."],
    ]);
  });

  it("finds a quote that only its text gives away", () => {
    const { html, quotes } = split(
      `<div>Sounds good.<br><br>On Wed, Nov 26, 2026 at 12:17 PM ${JONAS} wrote:<br>&gt; The team loved it.<br>&gt; Jonas</div>`
    );

    expect(textOf(html)).toBe("Sounds good.");
    expect(textOf(quotes[0]?.html ?? "")).toBe("The team loved it. Jonas");
    expect(quotes[0]?.sender.email).toBe("jonas@harbor.example");
  });

  it("keeps the lines of a quote cut out of preformatted text", () => {
    const { html, quotes } = split(
      `<pre>Sounds good.\n\nOn Wed, Nov 26, 2026 at 12:17 PM ${JONAS} wrote:\n&gt; The team loved it.\n&gt; Jonas</pre>`
    );

    const quote = quotes[0]?.html ?? "";

    expect(textOf(html)).toBe("Sounds good.");
    expect(hasElement(quote, "pre")).toBeTruthy();
    expect(quote).toContain("The team loved it.\nJonas");
  });

  it("takes one header off a quote and nothing that follows it", () => {
    const { quotes } = split(
      `<p>Approved.</p>${outlookWindowsQuote(MAYA, "<p>Update: the printer called.</p><p>Maya</p>")}`
    );

    expect(textOf(quotes[0]?.html ?? "")).toBe(
      "Update: the printer called. Maya"
    );
  });

  it("leaves the attribution of what a quoted message itself quoted", () => {
    const bottomPosted = `<div class="moz-cite-prefix">On 25.11.2026 09:14, Maya Lindqvist wrote:</div><blockquote type="cite"><p>Can you do Tuesday?</p></blockquote><p>Yes, Tuesday works.</p>`;

    const { quotes } = split(
      `<p>Great.</p>${gmailQuote(`On Wed, Nov 26, 2026 at 12:17 PM ${JONAS} wrote:`, bottomPosted)}`
    );

    expect(quotes).toHaveLength(1);
    expect(textOf(quotes[0]?.html ?? "")).toBe(
      "On 25.11.2026 09:14, Maya Lindqvist wrote: Can you do Tuesday? Yes, Tuesday works."
    );
    expect(hasElement(quotes[0]?.html ?? "", "blockquote")).toBeTruthy();
  });

  it("gives a quote of a message that said nothing no part", () => {
    const { html, quotes } = split(
      `<p>Hello?</p>${gmailQuote(`On Wed, Nov 26, 2026 at 12:17 PM ${JONAS} wrote:`, "<br>")}`
    );

    expect(textOf(html)).toBe("Hello?");
    expect(quotes).toStrictEqual([]);
  });

  it("returns the whole message as text for copying", () => {
    const { text } = split(
      `<p>Sounds good.</p>${gmailQuote(`On Wed, 13:17, ${MAYA} wrote:`, "<p>Good catch.</p>")}`
    );

    expect(text).toBe(
      "Sounds good.\nOn Wed, 13:17, Maya Lindqvist <maya@fernhill.example> wrote:\nGood catch."
    );
  });

  it.each([
    [
      "answers written between the quoted paragraphs",
      `<p>See my answers below.</p><div class="gmail_quote"><div class="gmail_attr">On Wed, 13:17, ${MAYA} wrote:<br></div><blockquote class="gmail_quote"><p>Can you do Tuesday?</p></blockquote><div>Yes, Tuesday works.</div><blockquote class="gmail_quote"><p>And the venue?</p></blockquote><div>The usual place.</div></div>`,
    ],
    [
      "a reply written above and under its quote",
      `<p>Two things.</p><div class="moz-cite-prefix">On 26.11.2026 12:17, Jonas Aalto wrote:</div><blockquote type="cite"><p>Can you do Tuesday?</p></blockquote><p>Yes, Tuesday works.</p>`,
    ],
    [
      "a reply under a blockquote no client marked",
      `<p>Two things.</p><p>On Wed, 13:17, ${MAYA} wrote:</p><blockquote><p>Can you do Tuesday?</p></blockquote><p>Yes, Tuesday works.</p>`,
    ],
    [
      "a reply written under its quote",
      `<div class="moz-cite-prefix">On 26.11.2026 12:17, Jonas Aalto wrote:</div><blockquote type="cite"><p>Can you do Tuesday?</p></blockquote><p>Yes, Tuesday works.</p>`,
    ],
    [
      "nothing but a quote",
      gmailQuote(`On Wed, 13:17, ${MAYA} wrote:`, "<p>Good catch.</p>"),
    ],
    [
      "a forwarded message",
      `<div dir="ltr">FYI, see below.</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <strong>Jonas Aalto</strong> &lt;jonas@harbor.example&gt;<br>Date: Wed, Nov 26, 2026 at 12:17 PM<br>Subject: Rebrand<br></div><br><p>The team loved it.</p></div>`,
    ],
    ["no quote at all", "<p>Hi,</p><p>Just checking in.</p><p>Maya</p>"],
  ])("leaves a message with %s whole", (_case, html) => {
    expect(splitQuotedHtml(html)).toBeNull();
  });
});
