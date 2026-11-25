import { randomUUID } from "node:crypto";

import {
  collectReferencedContentIds,
  normalizeContentId,
} from "../inline-images";
import { toIndexText } from "../message-text";

// Builds the RFC 5322 message Kisa hands to an SMTP server. Everything here
// may carry text from the user or from a message being answered, which is
// hostile, so every header value is stripped of line breaks and encoded, and
// every line stays far below the 998-octet limit.

export interface OutgoingAddress {
  readonly address: string;
  readonly name?: string | undefined;
}

export interface OutgoingAttachment {
  readonly bytes: Uint8Array;
  readonly contentId?: string | undefined;
  readonly filename: string;
  readonly mediaType: string;
}

export interface OutgoingBody {
  readonly html: string;
  readonly text: string;
}

export interface OutgoingMessage {
  readonly attachments: readonly OutgoingAttachment[];
  readonly bcc: readonly OutgoingAddress[];
  readonly body: OutgoingBody;
  readonly cc: readonly OutgoingAddress[];
  readonly date: Date;
  readonly from: OutgoingAddress;
  /** Message ids without angle brackets, as the cache keeps them. */
  readonly inReplyTo?: string | undefined;
  readonly messageId: string;
  readonly references?: readonly string[] | undefined;
  readonly subject: string;
  readonly to: readonly OutgoingAddress[];
}

export interface ComposedMessage {
  /** Every recipient, Bcc included, for the SMTP envelope. */
  readonly envelope: { readonly from: string; readonly to: readonly string[] };
  readonly messageId: string;
  /** The copy kept in Sent, which shows the sender whom they Bcc'd. */
  readonly sentCopy: Uint8Array;
  /** What goes to the server: no Bcc header, so no recipient learns of it. */
  readonly transmitted: Uint8Array;
}

const CRLF = "\r\n";
const BASE64_LINE = 76;

/**
 * UTF-8 bytes per encoded word: 52 base64 characters, 64 with its markers,
 * so a word after `Subject: ` still fits the 76 characters RFC 2047 allows.
 */
const ENCODED_WORD_BYTES = 39;
const MAX_PLAIN_HEADER = 900;

// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]+/gu;
const PLAIN_ASCII = /^[\u0020-\u007E]*$/u;
const ADDRESS = /^[^\s"(),:;<>@[\\\]]+@[^\s"(),:;<>@[\\\]]+$/u;
const MESSAGE_ID = /^[\u0021-\u003B\u003D\u003F-\u007E]+$/u;
const MEDIA_TYPE = /^[\w!#$&+.^-]+\/[\w!#$&+.^-]+$/u;
const CONTENT_ID = /^[\w%+.-]+(?:@[\w.-]+)?$/u;
const PARAMETER_SAFE = /^[\w!#$&+.^`|~-]$/u;

/** Header text on one line, with no control characters left in it. */
const cleanText = (value: string): string =>
  value.replaceAll(CONTROL_CHARACTERS, " ").trim();

export const isSendableAddress = (address: string): boolean =>
  ADDRESS.test(address);

/** RFC 2047 encoded words, split on characters and folded one per line. */
const encodeWords = (text: string): string => {
  const words: string[] = [];
  let current: number[] = [];

  for (const character of text) {
    const bytes = [...Buffer.from(character, "utf-8")];

    if (current.length + bytes.length > ENCODED_WORD_BYTES) {
      words.push(Buffer.from(current).toString("base64"));
      current = [];
    }

    current.push(...bytes);
  }

  if (current.length > 0 || words.length === 0) {
    words.push(Buffer.from(current).toString("base64"));
  }

  return words.map((word) => `=?UTF-8?B?${word}?=`).join(`${CRLF} `);
};

const headerText = (value: string): string => {
  const cleaned = cleanText(value);

  return PLAIN_ASCII.test(cleaned) && cleaned.length <= MAX_PLAIN_HEADER
    ? cleaned
    : encodeWords(cleaned);
};

const formatPhrase = (name: string): string => {
  const cleaned = cleanText(name);

  return PLAIN_ASCII.test(cleaned) && cleaned.length <= MAX_PLAIN_HEADER
    ? `"${cleaned.replaceAll(/["\\]/gu, String.raw`\$&`)}"`
    : encodeWords(cleaned);
};

const formatAddress = ({ address, name }: OutgoingAddress): string => {
  const phrase = name === undefined ? "" : cleanText(name);

  if (phrase.length === 0) {
    return address;
  }

  const formatted = formatPhrase(phrase);

  // An encoded name fills its line, so the address goes on the next one.
  return formatted.startsWith("=?")
    ? `${formatted}${CRLF} <${address}>`
    : `${formatted} <${address}>`;
};

const addressHeader = (
  name: string,
  addresses: readonly OutgoingAddress[]
): readonly string[] =>
  addresses.length === 0
    ? []
    : [`${name}: ${addresses.map(formatAddress).join(`,${CRLF} `)}`];

const messageIdToken = (id: string): string | undefined =>
  MESSAGE_ID.test(id) ? `<${id}>` : undefined;

const foldBase64 = (bytes: Uint8Array): string => {
  const encoded = Buffer.from(bytes).toString("base64");
  const lines: string[] = [];

  for (let start = 0; start < encoded.length; start += BASE64_LINE) {
    lines.push(encoded.slice(start, start + BASE64_LINE));
  }

  return lines.join(CRLF);
};

/** RFC 5322 date in UTC. */
const formatDate = (date: Date): string =>
  date.toUTCString().replace(/ GMT$/u, " +0000");

/** `name="value"` for ASCII, RFC 2231 `name*=UTF-8''…` otherwise. */
const parameter = (name: string, value: string): string => {
  const cleaned = cleanText(value).replaceAll(/[/\\]/gu, "_");

  if (PLAIN_ASCII.test(cleaned)) {
    return `${name}="${cleaned.replaceAll(/["\\]/gu, "_")}"`;
  }

  const encoded = [...Buffer.from(cleaned, "utf-8")]
    .map((byte) => {
      const character = String.fromCodePoint(byte);

      return byte < 0x80 && PARAMETER_SAFE.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");

  return `${name}*=UTF-8''${encoded}`;
};

const safeMediaType = (mediaType: string): string => {
  const cleaned = cleanText(mediaType).toLowerCase();

  return MEDIA_TYPE.test(cleaned) ? cleaned : "application/octet-stream";
};

/** A content id as written, without brackets, if it is safe in a header. */
const safeContentId = (contentId: string | undefined): string | undefined => {
  const cleaned = contentId?.trim().replaceAll(/^<|>$/gu, "");

  return cleaned !== undefined && CONTENT_ID.test(cleaned)
    ? cleaned
    : undefined;
};

const textPart = (mediaType: string, content: string): string =>
  [
    `Content-Type: ${mediaType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(Buffer.from(content, "utf-8")),
  ].join(CRLF);

const alternativePart = (body: OutgoingBody, boundary: string): string =>
  [
    `Content-Type: multipart/alternative;${CRLF} boundary="${boundary}"`,
    "",
    `--${boundary}`,
    textPart("text/plain", body.text),
    `--${boundary}`,
    textPart("text/html", body.html),
    `--${boundary}--`,
  ].join(CRLF);

const attachmentPart = (
  attachment: OutgoingAttachment,
  contentId: string | undefined,
  boundary: string
): string =>
  [
    `--${boundary}`,
    `Content-Type: ${safeMediaType(attachment.mediaType)};${CRLF} ${parameter("name", attachment.filename)}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${contentId === undefined ? "attachment" : "inline"};${CRLF} ${parameter("filename", attachment.filename)}`,
    ...(contentId === undefined ? [] : [`Content-ID: <${contentId}>`]),
    "",
    foldBase64(attachment.bytes),
  ].join(CRLF);

/**
 * Body and attachments. Images the HTML refers to by `cid:` sit with the
 * body in multipart/related; the rest are ordinary attachments.
 */
const contentPart = (message: OutgoingMessage, seed: string): string => {
  const alternative = alternativePart(message.body, `alt_${seed}`);
  const referenced = collectReferencedContentIds(message.body.html);
  const inline: { attachment: OutgoingAttachment; contentId: string }[] = [];
  const regular: OutgoingAttachment[] = [];

  for (const attachment of message.attachments) {
    const contentId = safeContentId(attachment.contentId);

    if (
      contentId !== undefined &&
      referenced.has(normalizeContentId(contentId))
    ) {
      inline.push({ attachment, contentId });
    } else {
      regular.push(attachment);
    }
  }

  const related =
    inline.length === 0
      ? alternative
      : [
          `Content-Type: multipart/related;${CRLF} boundary="rel_${seed}"`,
          "",
          `--rel_${seed}`,
          alternative,
          ...inline.map(({ attachment, contentId }) =>
            attachmentPart(attachment, contentId, `rel_${seed}`)
          ),
          `--rel_${seed}--`,
        ].join(CRLF);

  return regular.length === 0
    ? related
    : [
        `Content-Type: multipart/mixed;${CRLF} boundary="mix_${seed}"`,
        "",
        `--mix_${seed}`,
        related,
        ...regular.map((attachment) =>
          attachmentPart(attachment, undefined, `mix_${seed}`)
        ),
        `--mix_${seed}--`,
      ].join(CRLF);
};

const headerLines = (
  message: OutgoingMessage,
  withBcc: boolean
): readonly string[] => {
  const references = [
    ...new Set(
      (message.references ?? []).flatMap((id) => messageIdToken(id) ?? [])
    ),
  ];

  const inReplyTo =
    message.inReplyTo === undefined
      ? undefined
      : messageIdToken(message.inReplyTo);

  return [
    `Date: ${formatDate(message.date)}`,
    ...addressHeader("From", [message.from]),
    ...addressHeader("To", message.to),
    ...addressHeader("Cc", message.cc),
    ...(withBcc ? addressHeader("Bcc", message.bcc) : []),
    `Subject: ${headerText(message.subject)}`,
    `Message-ID: <${message.messageId}>`,
    ...(inReplyTo === undefined ? [] : [`In-Reply-To: ${inReplyTo}`]),
    ...(references.length === 0
      ? []
      : [`References: ${references.join(`${CRLF} `)}`]),
    "MIME-Version: 1.0",
  ];
};

/** A new Message-ID at the sender's domain, without angle brackets. */
export const newMessageId = (fromAddress: string): string => {
  const domain = fromAddress.slice(fromAddress.lastIndexOf("@") + 1);

  return `${randomUUID()}@${MESSAGE_ID.test(domain) ? domain : "kisa.invalid"}`;
};

export const composeMessage = (message: OutgoingMessage): ComposedMessage => {
  const seed = randomUUID().replaceAll("-", "");
  const content = contentPart(message, seed);

  const build = (withBcc: boolean): Uint8Array =>
    Buffer.from(
      `${[...headerLines(message, withBcc), content].join(CRLF)}${CRLF}`,
      "utf-8"
    );

  return {
    envelope: {
      from: message.from.address,
      to: [
        ...new Set(
          [...message.to, ...message.cc, ...message.bcc].map(
            (recipient) => recipient.address
          )
        ),
      ],
    },
    messageId: message.messageId,
    sentCopy: build(true),
    transmitted: build(false),
  };
};

// ----------------------------------------------------- replies, forwards

/** A message being answered or forwarded, as the cache has it. */
export interface QuotedMessage {
  readonly body: { readonly html?: string; readonly text?: string };
  readonly cc?: string | undefined;
  readonly from: string;
  readonly sentAt: number;
  readonly subject: string;
  readonly to?: string | undefined;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const textToHtml = (value: string): string =>
  escapeHtml(value).replaceAll(/\r?\n/gu, "<br>");

const quotedContent = (quoted: QuotedMessage): OutgoingBody => {
  const { html, text } = quoted.body;

  if (html !== undefined && html.length > 0) {
    return { html, text: text ?? toIndexText(html) };
  }

  return { html: `<div>${textToHtml(text ?? "")}</div>`, text: text ?? "" };
};

const ATTRIBUTION_DATE = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export const replyBody = (
  body: OutgoingBody,
  quoted: QuotedMessage
): OutgoingBody => {
  const original = quotedContent(quoted);
  const attribution = `On ${ATTRIBUTION_DATE.format(quoted.sentAt)}, ${quoted.from} wrote:`;

  const quotedText = original.text
    .split(/\r?\n/gu)
    .map((line) => `> ${line}`)
    .join("\n");

  return {
    html: `${body.html}<div><br></div><div class="gmail_quote"><div class="gmail_attr">${escapeHtml(attribution)}<br></div><blockquote class="gmail_quote">${original.html}</blockquote></div>`,
    text: `${body.text}\n\n${attribution}\n${quotedText}`,
  };
};

export const forwardBody = (
  body: OutgoingBody,
  quoted: QuotedMessage
): OutgoingBody => {
  const original = quotedContent(quoted);

  const headers = [
    "---------- Forwarded message ---------",
    `From: ${quoted.from}`,
    `Date: ${ATTRIBUTION_DATE.format(quoted.sentAt)}`,
    `Subject: ${quoted.subject}`,
    ...(quoted.to === undefined ? [] : [`To: ${quoted.to}`]),
    ...(quoted.cc === undefined ? [] : [`Cc: ${quoted.cc}`]),
  ];

  return {
    html: `${body.html}<div><br></div><div class="gmail_quote">${headers.map(escapeHtml).join("<br>")}<br><br>${original.html}</div>`,
    text: `${body.text}\n\n${headers.join("\n")}\n\n${original.text}`,
  };
};

const withPrefix = (prefix: string, subject: string): string =>
  subject.toLowerCase().startsWith(prefix.toLowerCase())
    ? subject
    : `${prefix} ${subject}`;

export const replySubject = (subject: string): string =>
  withPrefix("Re:", subject);

export const forwardSubject = (subject: string): string =>
  withPrefix("Fwd:", subject);
