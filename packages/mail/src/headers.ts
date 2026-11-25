import { decodeCharset } from "./text-decoding";

export interface MessageHeader {
  readonly name: string;
  readonly value: string;
}

/** More than any real message carries; beyond it the rest is ignored. */
const MAX_HEADERS = 1000;

/** Printable ASCII except the colon (RFC 5322 section 2.2). */
const HEADER_NAME_PATTERN = /^[!-9;-~]+$/u;

/**
 * Splits on `=?charset?B|Q?text?=`. The parts of an encoded word cannot hold
 * `?` or whitespace, so this pattern has no backtracking that a long header
 * could exploit.
 */
const ENCODED_WORD_PATTERN =
  /[=]\?(?<charset>[^?\s]+)\?(?<encoding>[BbQq])\?(?<text>[^?\s]*)\?=/gu;

const LINEAR_WHITESPACE_PATTERN = /^[\t\n\r ]*$/u;

const decodeWordBytes = (encoding: string, text: string): Uint8Array => {
  if (encoding === "B" || encoding === "b") {
    return Buffer.from(text, "base64");
  }

  const bytes: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === "_") {
      bytes.push(0x20);
    } else if (character === "=") {
      const value = Number.parseInt(text.slice(index + 1, index + 3), 16);

      if (Number.isNaN(value)) {
        bytes.push(0x3d);
      } else {
        bytes.push(value);
        index += 2;
      }
    } else {
      bytes.push(((character ?? "").codePointAt(0) ?? 0) % 256);
    }
  }

  return Uint8Array.from(bytes);
};

/**
 * Decodes RFC 2047 encoded words. Whitespace between two encoded words is
 * dropped, and the bytes of neighbouring words in one charset are joined
 * before decoding, because senders split multi-byte characters across words.
 */
export const decodeEncodedWords = (value: string): string => {
  if (!value.includes("=?")) {
    return value;
  }

  let output = "";
  let lastIndex = 0;
  let pending: { charset: string; chunks: Uint8Array[] } | undefined;

  const flush = (): void => {
    if (pending !== undefined) {
      output += decodeCharset(Buffer.concat(pending.chunks), pending.charset);
      pending = undefined;
    }
  };

  for (const match of value.matchAll(ENCODED_WORD_PATTERN)) {
    const between = value.slice(lastIndex, match.index);
    // RFC 2231 allows a language after `*`; it does not change the bytes.
    const charset = (match.groups?.charset ?? "").split("*")[0] ?? "";

    const bytes = decodeWordBytes(
      match.groups?.encoding ?? "Q",
      match.groups?.text ?? ""
    );

    if (pending === undefined || !LINEAR_WHITESPACE_PATTERN.test(between)) {
      flush();
      output += between;
    }

    if (pending?.charset.toLowerCase() === charset.toLowerCase()) {
      pending.chunks.push(bytes);
    } else {
      flush();
      pending = { charset, chunks: [bytes] };
    }

    lastIndex = match.index + match[0].length;
  }

  flush();

  return output + value.slice(lastIndex);
};

/**
 * Reads a header block (everything before the first empty line) into
 * unfolded, decoded fields. Bytes that are not valid UTF-8 are replaced, and
 * lines that are not fields are skipped.
 */
export const parseHeaderBlock = (
  block: Uint8Array
): readonly MessageHeader[] => {
  const headers: MessageHeader[] = [];
  let name: string | undefined;
  let value = "";

  const flush = (): void => {
    if (name !== undefined && headers.length < MAX_HEADERS) {
      headers.push({ name, value: decodeEncodedWords(value.trim()) });
    }

    name = undefined;
    value = "";
  };

  for (const line of decodeCharset(block, "utf-8").split(/\r?\n/u)) {
    if (line.length === 0) {
      break;
    }

    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (name !== undefined) {
        value += line;
      }

      continue;
    }

    flush();

    if (headers.length >= MAX_HEADERS) {
      break;
    }

    const colon = line.indexOf(":");
    const candidate = colon > 0 ? line.slice(0, colon).trimEnd() : "";

    if (HEADER_NAME_PATTERN.test(candidate)) {
      name = candidate;
      value = line.slice(colon + 1);
    }
  }

  flush();

  return headers;
};

export const getHeaderValues = (
  headers: readonly MessageHeader[],
  name: string
): readonly string[] => {
  const lowerName = name.toLowerCase();

  return headers.flatMap((header) =>
    header.name.toLowerCase() === lowerName ? [header.value] : []
  );
};

export const getHeaderValue = (
  headers: readonly MessageHeader[],
  name: string
): string | undefined => getHeaderValues(headers, name)[0];

const MESSAGE_ID_PATTERN = /<(?<id>[^<>\s]+)>/gu;

/**
 * The message ids in a `References`, `In-Reply-To` or `Message-ID` value, in
 * order and without angle brackets. A bare id without brackets is accepted
 * when it is the whole value.
 */
export const parseMessageIds = (value?: string): readonly string[] => {
  if (value === undefined) {
    return [];
  }

  const ids = [...value.matchAll(MESSAGE_ID_PATTERN)].flatMap((match) =>
    match.groups?.id === undefined ? [] : [match.groups.id]
  );

  if (ids.length > 0) {
    return ids;
  }

  const bare = value.trim();

  return bare.length > 0 && !/\s/u.test(bare) ? [bare] : [];
};
