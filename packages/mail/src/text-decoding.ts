// Message text arrives in whatever transfer encoding and character set the
// sender chose. Everything here is sender-controlled input: malformed data is
// decoded leniently and never throws.

const ASCII_LABELS: ReadonlySet<string> = new Set([
  "ansi_x3.4-1968",
  "ascii",
  "us-ascii",
]);

const utf8 = new TextDecoder("utf-8");
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

const normalizeCharsetLabel = (charset: string | undefined): string =>
  (charset ?? "")
    .trim()
    .replaceAll(/^["']+|["']+$/gu, "")
    .toLowerCase();

/**
 * Converts text bytes to a string. Unknown labels fall back to UTF-8, and
 * text labelled ASCII that is really UTF-8 (a common sender mistake) is read
 * as UTF-8 rather than turned into Windows-1252 mojibake.
 */
export const decodeCharset = (bytes: Uint8Array, charset?: string): string => {
  const label = normalizeCharsetLabel(charset);

  if (label.length === 0 || label === "utf-8") {
    return utf8.decode(bytes);
  }

  if (ASCII_LABELS.has(label)) {
    try {
      return strictUtf8.decode(bytes);
    } catch {
      return new TextDecoder("windows-1252").decode(bytes);
    }
  }

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return utf8.decode(bytes);
  }
};

const BASE64_ALPHABET = /[^A-Za-z0-9+/=]/gu;

const decodeBase64 = (bytes: Uint8Array): Uint8Array =>
  Buffer.from(
    Buffer.from(bytes).toString("latin1").replaceAll(BASE64_ALPHABET, ""),
    "base64"
  );

const EQUALS = 0x3d;
const CARRIAGE_RETURN = 0x0d;
const LINE_FEED = 0x0a;

const hexValue = (byte: number | undefined): number => {
  if (byte === undefined) {
    return -1;
  }

  if (byte >= 0x30 && byte <= 0x39) {
    return byte - 0x30;
  }

  if (byte >= 0x41 && byte <= 0x46) {
    return byte - 0x37;
  }

  if (byte >= 0x61 && byte <= 0x66) {
    return byte - 0x57;
  }

  return -1;
};

const decodeQuotedPrintable = (bytes: Uint8Array): Uint8Array => {
  const output = new Uint8Array(bytes.length);
  let length = 0;
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes[index];

    if (byte !== EQUALS) {
      output[length] = byte ?? 0;
      length += 1;
      index += 1;
      continue;
    }

    const next = bytes[index + 1];

    // A soft line break joins two encoded lines.
    if (next === CARRIAGE_RETURN && bytes[index + 2] === LINE_FEED) {
      index += 3;
      continue;
    }

    if (next === LINE_FEED) {
      index += 2;
      continue;
    }

    const high = hexValue(next);
    const low = hexValue(bytes[index + 2]);

    if (high === -1 || low === -1) {
      // Not an escape: keep the `=` as written.
      output[length] = EQUALS;
      length += 1;
      index += 1;
      continue;
    }

    output[length] = high * 16 + low;
    length += 1;
    index += 3;
  }

  return output.subarray(0, length);
};

/** Removes a part's `Content-Transfer-Encoding`; unknown encodings pass through. */
export const decodeTransferEncoding = (
  bytes: Uint8Array,
  encoding?: string
): Uint8Array => {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "base64": {
      return decodeBase64(bytes);
    }

    case "quoted-printable": {
      return decodeQuotedPrintable(bytes);
    }

    default: {
      return bytes;
    }
  }
};

/** A text part as stored on the server, read as a string. */
export const decodeTextPart = (
  bytes: Uint8Array,
  encoding: string | undefined,
  charset: string | undefined
): string => decodeCharset(decodeTransferEncoding(bytes, encoding), charset);
