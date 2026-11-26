import { decodeEncodedWords } from "@repo/mail/headers";
import type { BodyStructureNode } from "@repo/mail/mime-structure";
import type { EnvelopeAddress, MessageEnvelope } from "@repo/mail/session";

// Reads a message the way an IMAP server describes one: its envelope, its
// `BODYSTRUCTURE` and each part's bytes by section number. It reads what
// `composeMessage` writes, which is all the demo server ever stores: ASCII
// headers, CRLF line ends, and nested multiparts whose boundaries differ in
// their first characters. It is not a general MIME parser.

const CRLF = "\r\n";

/** A header field unfolded onto one line, its encoded words left as sent. */
export interface RawHeader {
  readonly name: string;
  readonly value: string;
}

export interface ParsedMessage {
  readonly envelope: MessageEnvelope;
  readonly headers: readonly RawHeader[];
  /** Each leaf part's bytes, still in their transfer encoding. */
  readonly sections: ReadonlyMap<string, Uint8Array>;
  readonly size: number;
  readonly structure: BodyStructureNode;
}

const splitEntity = (entity: string): { body: string; head: string } => {
  const end = entity.indexOf(`${CRLF}${CRLF}`);

  return end === -1
    ? { body: "", head: entity }
    : { body: entity.slice(end + 4), head: entity.slice(0, end) };
};

const unfoldHeaders = (head: string): readonly RawHeader[] => {
  const headers: { name: string; value: string }[] = [];

  for (const line of head.split(CRLF)) {
    const last = headers.at(-1);

    if ((line.startsWith(" ") || line.startsWith("\t")) && last !== undefined) {
      last.value += line;
      continue;
    }

    const colon = line.indexOf(":");

    if (colon > 0) {
      headers.push({
        name: line.slice(0, colon).trim(),
        value: line.slice(colon + 1).trim(),
      });
    }
  }

  return headers;
};

const headerValue = (
  headers: readonly RawHeader[],
  name: string
): string | undefined =>
  headers.find((header) => header.name.toLowerCase() === name)?.value;

/** Splits on `separator` where it is outside quotes and angle brackets. */
const splitTopLevel = (value: string, separator: string): readonly string[] => {
  const parts: string[] = [];
  let current = "";
  let isQuoted = false;
  let isBracketed = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";

    if (isQuoted && character === "\\") {
      current += character + (value[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (character === '"') {
      isQuoted = !isQuoted;
    } else if (!isQuoted && (character === "<" || character === ">")) {
      isBracketed = character === "<";
    }

    if (character === separator && !isQuoted && !isBracketed) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  parts.push(current);

  return parts;
};

/** The value after the charset and language of an RFC 2231 parameter. */
const decodeExtendedValue = (value: string): string => {
  const encoded = value.slice(value.lastIndexOf("'") + 1);

  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
};

/** A `value; name="parameter"` field such as `Content-Type`. */
const parseParameterized = (field: string | undefined) => {
  const [value = "", ...rest] = splitTopLevel(field ?? "", ";");
  const parameters: Record<string, string> = {};

  for (const part of rest) {
    const equals = part.indexOf("=");

    if (equals === -1) {
      continue;
    }

    const name = part.slice(0, equals).trim().toLowerCase();
    const raw = part.slice(equals + 1).trim();

    if (name.endsWith("*")) {
      parameters[name.slice(0, -1)] = decodeExtendedValue(raw);
    } else {
      parameters[name] =
        raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    }
  }

  return { parameters, value: value.trim().toLowerCase() };
};

const toAddress = (entry: string): EnvelopeAddress | undefined => {
  const open = entry.lastIndexOf("<");
  const close = entry.indexOf(">", open);

  if (open === -1 || close === -1) {
    const address = entry.trim();

    return address.includes("@") ? { address } : undefined;
  }

  const address = entry.slice(open + 1, close).trim();
  const phrase = entry.slice(0, open).trim();

  const name =
    phrase.startsWith('"') && phrase.endsWith('"')
      ? phrase.slice(1, -1).replaceAll(/\\(?<escaped>["\\])/gu, "$<escaped>")
      : decodeEncodedWords(phrase);

  return name.length === 0 ? { address } : { address, name };
};

const toAddresses = (
  headers: readonly RawHeader[],
  name: string
): readonly EnvelopeAddress[] =>
  splitTopLevel(headerValue(headers, name) ?? "", ",").flatMap((entry) => {
    const address = toAddress(entry);

    return address === undefined ? [] : [address];
  });

const toEnvelope = (headers: readonly RawHeader[]): MessageEnvelope => {
  const date = Date.parse(headerValue(headers, "date") ?? "");
  const subject = headerValue(headers, "subject");

  return {
    bcc: toAddresses(headers, "bcc"),
    cc: toAddresses(headers, "cc"),
    date: Number.isNaN(date) ? undefined : date,
    from: toAddresses(headers, "from"),
    inReplyTo: headerValue(headers, "in-reply-to"),
    messageId: headerValue(headers, "message-id"),
    replyTo: toAddresses(headers, "reply-to"),
    sender: [],
    subject: subject === undefined ? undefined : decodeEncodedWords(subject),
    to: toAddresses(headers, "to"),
  };
};

/** The parts between a multipart's delimiters, without preamble or epilogue. */
const splitMultipart = (body: string, boundary: string): readonly string[] => {
  const [, ...segments] = `${CRLF}${body}`.split(`${CRLF}--${boundary}`);
  const parts: string[] = [];

  for (const segment of segments) {
    // The closing delimiter is `--boundary--`.
    if (segment.startsWith("--")) {
      break;
    }

    parts.push(segment.slice(segment.indexOf(CRLF) + CRLF.length));
  }

  return parts;
};

const toStructure = (
  entity: string,
  part: string | undefined,
  sections: Map<string, Uint8Array>
): BodyStructureNode => {
  const { body, head } = splitEntity(entity);
  const headers = unfoldHeaders(head);

  const type = parseParameterized(
    headerValue(headers, "content-type") ?? "text/plain"
  );

  const { boundary } = type.parameters;

  if (type.value.startsWith("multipart/") && boundary !== undefined) {
    return {
      childNodes: splitMultipart(body, boundary).map((child, index) =>
        toStructure(
          child,
          part === undefined ? String(index + 1) : `${part}.${index + 1}`,
          sections
        )
      ),
      part,
      type: type.value,
    };
  }

  // A single-part message's only section is "1" (RFC 3501 section 6.4.5).
  const bytes = Buffer.from(body, "latin1");
  sections.set(part ?? "1", bytes);

  const disposition = parseParameterized(
    headerValue(headers, "content-disposition")
  );

  return {
    disposition: disposition.value.length === 0 ? undefined : disposition.value,
    dispositionParameters: disposition.parameters,
    encoding: headerValue(headers, "content-transfer-encoding") ?? "7bit",
    id: headerValue(headers, "content-id"),
    parameters: type.parameters,
    part,
    size: bytes.length,
    type: type.value,
  };
};

export const parseMessage = (raw: Uint8Array): ParsedMessage => {
  // Latin-1 keeps every byte as one character, so sections come back exact.
  const text = Buffer.from(raw).toString("latin1");
  const sections = new Map<string, Uint8Array>();
  const structure = toStructure(text, undefined, sections);
  const headers = unfoldHeaders(splitEntity(text).head);

  return {
    envelope: toEnvelope(headers),
    headers,
    sections,
    size: raw.length,
    structure,
  };
};

/** The named fields as a header block, as `BODY[HEADER.FIELDS (...)]` is. */
export const toHeaderBlock = (
  headers: readonly RawHeader[],
  names: readonly string[] | true
): Uint8Array => {
  const wanted =
    names === true
      ? undefined
      : new Set(names.map((name) => name.toLowerCase()));

  const lines = headers.flatMap((header) =>
    (wanted?.has(header.name.toLowerCase()) ?? true)
      ? [`${header.name}: ${header.value}`]
      : []
  );

  return Buffer.from(`${[...lines, "", ""].join(CRLF)}`, "latin1");
};
