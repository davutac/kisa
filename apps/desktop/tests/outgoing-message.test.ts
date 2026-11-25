import { describe, expect, it } from "vitest";

import {
  composeMessage,
  replyBody,
  replySubject,
} from "../src/main/mail/engine/outgoing-message";
import type { OutgoingMessage } from "../src/main/mail/engine/outgoing-message";

const message = (
  overrides: Partial<OutgoingMessage> = {}
): OutgoingMessage => ({
  attachments: [],
  bcc: [{ address: "hidden@example.com" }],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  date: new Date("2026-11-21T10:00:00Z"),
  from: { address: "me@example.com", name: "Me" },
  messageId: "abc@example.com",
  subject: "Plans",
  to: [{ address: "friend@example.com", name: "Friend" }],
  ...overrides,
});

const text = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("utf-8");

const headersOf = (raw: string): string => raw.split("\r\n\r\n")[0] ?? "";

describe("outgoing messages", () => {
  it("keeps Bcc off the wire but in the envelope and the Sent copy", () => {
    const composed = composeMessage(message());

    expect(headersOf(text(composed.transmitted))).not.toMatch(/^bcc:/imu);
    expect(headersOf(text(composed.sentCopy))).toMatch(
      /^Bcc: hidden@example\.com$/mu
    );
    expect(composed.envelope).toStrictEqual({
      from: "me@example.com",
      to: ["friend@example.com", "hidden@example.com"],
    });
  });

  it("encodes names and subjects so no line break reaches the headers", () => {
    const raw = text(
      composeMessage(
        message({
          subject: "Hi\r\nBcc: victim@example.com",
          to: [{ address: "friend@example.com", name: "Zoë\r\nX-Evil: 1" }],
        })
      ).transmitted
    );

    const headers = headersOf(raw);

    expect(headers).not.toMatch(/^(?:bcc|x-evil):/imu);
    expect(headers).toMatch(
      /^To: =\?UTF-8\?B\?[\w+/=]+\?=\r\n <friend@example\.com>$/mu
    );
    expect(headers).toContain("Subject: Hi Bcc: victim@example.com");
  });

  it("keeps every line short, however large the attachment", () => {
    const raw = text(
      composeMessage(
        message({
          attachments: [
            {
              bytes: new Uint8Array(200_000).fill(7),
              filename: "naïve résumé.pdf",
              mediaType: "application/pdf\r\nX-Evil: 1",
            },
          ],
          subject: "ü".repeat(400),
        })
      ).transmitted
    );

    const lines = raw.split("\r\n");
    // 998 octets is the hard limit; base64 is folded at 76.
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
      78
    );
    expect(raw).toContain(
      "Content-Type: application/octet-stream;\r\n name*=UTF-8''na%C3%AFve%20r%C3%A9sum%C3%A9.pdf"
    );
    expect(raw).not.toMatch(/^X-Evil:/mu);
  });

  it("threads replies by parsed message ids only", () => {
    const headers = headersOf(
      text(
        composeMessage(
          message({
            inReplyTo: "parent@example.com",
            references: [
              "root@example.com",
              "bad>\r\nX: 1",
              "parent@example.com",
            ],
            subject: replySubject("Plans"),
          })
        ).transmitted
      )
    );

    expect(headers).toContain("In-Reply-To: <parent@example.com>");
    expect(headers).toContain(
      "References: <root@example.com>\r\n <parent@example.com>"
    );
    expect(headers).toContain("Subject: Re: Plans");
  });

  it("places images the body refers to beside it and the rest as attachments", () => {
    const raw = text(
      composeMessage(
        message({
          attachments: [
            {
              bytes: new Uint8Array([1]),
              contentId: "<Logo@Example>",
              filename: "logo.png",
              mediaType: "image/png",
            },
            {
              bytes: new Uint8Array([2]),
              filename: "notes.txt",
              mediaType: "text/plain",
            },
          ],
          body: { html: '<img src="cid:logo@example">', text: "" },
        })
      ).transmitted
    );

    expect(raw).toMatch(/multipart\/mixed[\s\S]*multipart\/related/u);
    expect(raw).toContain("Content-ID: <Logo@Example>");
    expect(raw).toContain(
      'Content-Disposition: attachment;\r\n filename="notes.txt"'
    );
  });

  it("quotes the message replied to under the new text", () => {
    const body = replyBody(
      { html: "<p>Sure</p>", text: "Sure" },
      {
        body: { text: "Lunch?\nTomorrow" },
        from: "Friend <friend@example.com>",
        sentAt: Date.UTC(2026, 10, 20, 12),
        subject: "Plans",
      }
    );

    expect(body.text).toMatch(
      /^Sure\n\nOn .+, Friend <friend@example\.com> wrote:\n> Lunch\?\n> Tomorrow$/u
    );
    expect(body.html).toContain(
      '<blockquote class="gmail_quote"><div>Lunch?<br>Tomorrow</div></blockquote>'
    );
  });
});
