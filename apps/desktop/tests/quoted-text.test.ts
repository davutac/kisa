// What these tests prove is where a plain-text body's trailing quote begins,
// and that a body whose quote must stay in view is left whole. A wrong answer
// hides what the sender wrote. The same patterns place the fold in an HTML
// message; that markup is walked in a real frame, which no test here loads.
import { describe, expect, it } from "vitest";

import {
  findQuotedTextStart,
  isForwardSubject,
  parseQuoteSender,
  splitQuotedTextChain,
} from "@/mail/quoted-text";

const startOf = (text: string): number | null =>
  findQuotedTextStart(text.split("\n"));

describe(findQuotedTextStart, () => {
  it("finds a Gmail reply's quote at its attribution", () => {
    const text = [
      "Sounds good, see you then.",
      "",
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> The team loved it.",
      ">",
      "> Jonas",
    ].join("\n");

    expect(startOf(text)).toBe(2);
  });

  it("joins an attribution that the sender's client wrapped", () => {
    const text = [
      "Ok.",
      "",
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto",
      "<jonas@example.com> wrote:",
      "",
      "> hi",
    ].join("\n");

    expect(startOf(text)).toBe(2);
  });

  it("keeps the reply's last line out of an attribution right under it", () => {
    const text = [
      "Hi Jonas,",
      "Thanks for this.",
      "Jonas Aalto <jonas@example.com> wrote:",
      "> hi",
    ].join("\n");

    expect(startOf(text)).toBe(2);
  });

  it("keeps a reply's sentence that opens with On out of the attribution", () => {
    const text = [
      "On Monday we ship.",
      "Jonas Aalto <jonas@example.com> wrote:",
      "> hi",
    ].join("\n");

    expect(startOf(text)).toBe(1);
  });

  it.each([
    "Am Mi., 26. Nov. 2026 um 12:17 Uhr schrieb Jonas Aalto <jonas@example.com>:",
    "Le mer. 26 nov. 2026 à 12:17, Jonas Aalto <jonas@example.com> a écrit :",
    "El mié, 26 nov 2026 a las 12:17, Jonas Aalto (<jonas@example.com>) escribió:",
    "Op wo 26 nov 2026 om 12:17 schreef Jonas Aalto <jonas@example.com>:",
    "26 Kas 2026 Çar, saat 12:17 tarihinde Jonas Aalto <jonas@example.com> şunu yazdı:",
    "2026年11月26日(水) 12:17 Jonas Aalto <jonas@example.com>:",
    "-----Original Message-----",
  ])("knows the header %s", (header) => {
    expect(startOf(["Thanks.", "", header, "> hi"].join("\n"))).toBe(2);
  });

  it("starts an Outlook quote at the rule over its header block", () => {
    const text = [
      "Thanks, approved.",
      "",
      "________________________________",
      "From: Jonas Aalto <jonas@example.com>",
      "Sent: Wednesday, November 26, 2026 12:17 PM",
      "To: Maya Lindqvist <maya@example.com>",
      "Subject: Rebrand",
      "",
      "The team loved it.",
    ].join("\n");

    expect(startOf(text)).toBe(2);
  });

  it("reads a From line in prose as prose", () => {
    const text = [
      "From: the shop managers, two notes.",
      "",
      "Menu boards need larger prices.",
    ].join("\n");

    expect(startOf(text)).toBeNull();
  });

  it("folds a trailing quote with an attribution it does not know", () => {
    const text = [
      "Agreed.",
      "",
      "Jonas Aalto kirjoitti:",
      "> hi",
      "> there",
    ].join("\n");

    expect(startOf(text)).toBe(2);
  });

  it("leaves a reply that answers between the quoted lines whole", () => {
    const text = [
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> Can you do Tuesday?",
      "Yes, Tuesday works.",
      "",
      "> And the venue?",
      "The usual place.",
    ].join("\n");

    expect(startOf(text)).toBeNull();
  });

  it("leaves a reply written under its quote whole", () => {
    const text = [
      "Hi,",
      "",
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> Can you do Tuesday?",
      "",
      "Yes, Tuesday works.",
    ].join("\n");

    expect(startOf(text)).toBeNull();
  });

  it("leaves a body that is nothing but quote whole", () => {
    const text = [
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> The team loved it.",
    ].join("\n");

    expect(startOf(text)).toBeNull();
  });

  it("leaves a forwarded message in view", () => {
    const text = [
      "FYI, see below.",
      "",
      "---------- Forwarded message ---------",
      "From: Jonas Aalto <jonas@example.com>",
      "Date: Wed, Nov 26, 2026 at 12:17 PM",
      "Subject: Rebrand",
      "",
      "The team loved it.",
    ].join("\n");

    expect(startOf(text)).toBeNull();
  });

  it("folds a quote that holds an older forward", () => {
    const text = [
      "Thanks.",
      "",
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> ---------- Forwarded message ---------",
      "> From: Priya <priya@example.com>",
    ].join("\n");

    expect(startOf(text)).toBe(2);
  });
});

describe(splitQuotedTextChain, () => {
  it("unpacks a chain of quotes into one unquoted message each", () => {
    const text = [
      "Sounds good.",
      "",
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> The team loved it.",
      ">",
      "> On Tue, Nov 25, 2026 at 9:14 AM Maya Lindqvist <maya@example.com> wrote:",
      "> > Round two is attached.",
      "> >",
      "> > On Mon, Nov 24, 2026 at 8:00 AM Jonas Aalto <jonas@example.com> wrote:",
      "> > > Send it over.",
    ].join("\n");

    const split = splitQuotedTextChain(text);

    expect(split?.reply).toBe("Sounds good.");
    expect(
      split?.quotes.map((quote) => [quote.sender.email, quote.text])
    ).toStrictEqual([
      ["jonas@example.com", "The team loved it."],
      ["maya@example.com", "Round two is attached."],
      ["jonas@example.com", "Send it over."],
    ]);
  });

  it("unpacks Outlook's header blocks, which quote without marks", () => {
    const text = [
      "Approved.",
      "",
      "From: Jonas Aalto <jonas@example.com>",
      "Sent: Wednesday, November 26, 2026 12:17 PM",
      "Subject: Rebrand",
      "",
      "The team loved it.",
      "",
      "From: Maya Lindqvist <maya@example.com>",
      "Sent: Tuesday, November 25, 2026 9:14 AM",
      "Subject: Rebrand",
      "",
      "Dear Jonas:",
      "Round two is attached.",
    ].join("\n");

    expect(
      splitQuotedTextChain(text)?.quotes.map((quote) => [
        quote.sender.attribution,
        quote.text,
      ])
    ).toStrictEqual([
      [
        "From: Jonas Aalto <jonas@example.com> · Sent: Wednesday, November 26, 2026 12:17 PM",
        "The team loved it.",
      ],
      [
        "From: Maya Lindqvist <maya@example.com> · Sent: Tuesday, November 25, 2026 9:14 AM",
        "Dear Jonas:\nRound two is attached.",
      ],
    ]);
  });

  it("keeps a forward inside a quote with the message that sent it", () => {
    const text = [
      "Thanks.",
      "",
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      "> See below.",
      ">",
      "> ---------- Forwarded message ---------",
      "> From: Priya Raman <priya@example.com>",
      "> Date: Tue, Nov 25, 2026 at 9:14 AM",
      ">",
      "> The contract is signed.",
    ].join("\n");

    const quotes = splitQuotedTextChain(text)?.quotes ?? [];

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.text).toContain("The contract is signed.");
  });

  it("returns nothing for a body without a quote", () => {
    expect(splitQuotedTextChain("Hi,\n\nJust checking in.\n\nMaya")).toBeNull();
  });
});

describe(parseQuoteSender, () => {
  it.each([
    [
      "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto <jonas@example.com> wrote:",
      { email: "jonas@example.com", name: "Jonas Aalto" },
    ],
    [
      "On Nov 26, 2026, at 12:17, Jonas Aalto <jonas@example.com> wrote:",
      { email: "jonas@example.com", name: "Jonas Aalto" },
    ],
    [
      "Am Mi., 26. Nov. 2026 um 12:17 Uhr schrieb Jonas Aalto <jonas@example.com>:",
      { email: "jonas@example.com", name: "Jonas Aalto" },
    ],
    [
      "On Wednesday, Jonas Aalto wrote:",
      { email: undefined, name: "Jonas Aalto" },
    ],
    [
      "Le mer. 26 nov. 2026 à 12:17, Jan van der Berg <jan@example.com> a écrit :",
      { email: "jan@example.com", name: "Jan van der Berg" },
    ],
    [
      "On Wed, Nov 26, 2026 at 12:17 PM <jonas@example.com> wrote:",
      { email: "jonas@example.com", name: undefined },
    ],
  ])("reads the sender of %s", (attribution, sender) => {
    expect(parseQuoteSender([attribution, "> hi"])).toStrictEqual({
      ...sender,
      attribution,
    });
  });

  it("reads the sender of an Outlook header block from its From field", () => {
    expect(
      parseQuoteSender([
        "________________________________",
        "From: Jonas Aalto <jonas@example.com>",
        "Sent: Wednesday, November 26, 2026 12:17 PM",
      ])
    ).toStrictEqual({
      attribution:
        "From: Jonas Aalto <jonas@example.com> · Sent: Wednesday, November 26, 2026 12:17 PM",
      email: "jonas@example.com",
      name: "Jonas Aalto",
    });
  });

  it("reads a From field that names no address", () => {
    expect(
      parseQuoteSender(["From: Jonas Aalto", "Sent: Wednesday, 12:17"])
    ).toMatchObject({ email: undefined, name: "Jonas Aalto" });
  });

  it("joins an attribution wrapped onto a second line", () => {
    expect(
      parseQuoteSender([
        "On Wed, Nov 26, 2026 at 12:17 PM Jonas Aalto",
        "<jonas@example.com> wrote:",
      ])
    ).toMatchObject({ email: "jonas@example.com", name: "Jonas Aalto" });
  });

  it("gives a quote that opens with no header no attribution", () => {
    expect(parseQuoteSender(["> hi", "> there"])).toStrictEqual({
      attribution: undefined,
      email: undefined,
      name: undefined,
    });
  });
});

describe(isForwardSubject, () => {
  it.each([
    ["Fwd: Rebrand", true],
    ["FW: Rebrand", true],
    ["WG: Rebrand", true],
    ["[Clients] Fwd: Rebrand", true],
    ["Re: Fwd: Rebrand", false],
    ["Rebrand: round two feedback", false],
  ])("reads %s as a forward: %s", (subject, expected) => {
    expect(isForwardSubject(subject)).toBe(expected);
  });
});
