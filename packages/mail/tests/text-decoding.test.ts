import { describe, expect, it } from "vitest";

import {
  decodeCharset,
  decodeTextPart,
  decodeTransferEncoding,
} from "../src/text-decoding";

const bytes = (value: string): Uint8Array => Buffer.from(value, "latin1");

describe(decodeTransferEncoding, () => {
  it("decodes base64 and ignores line breaks and junk", () => {
    const encoded = bytes("SGVs\r\nbG8s\n IHdvcmxk!*");
    expect(
      Buffer.from(decodeTransferEncoding(encoded, "BASE64")).toString()
    ).toBe("Hello, world");
  });

  it("decodes quoted-printable escapes and soft line breaks", () => {
    const encoded = bytes("caf=C3=A9 au l=\r\nait=\nsoft = not-hex =4");
    expect(
      Buffer.from(
        decodeTransferEncoding(encoded, "quoted-printable")
      ).toString()
    ).toBe("café au laitsoft = not-hex =4");
  });

  it("passes other encodings through", () => {
    const encoded = bytes("plain");
    expect(decodeTransferEncoding(encoded, "8bit")).toBe(encoded);
    expect(decodeTransferEncoding(encoded)).toBe(encoded);
  });
});

describe(decodeCharset, () => {
  it("decodes legacy charsets", () => {
    expect(
      decodeCharset(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), "ISO-8859-1")
    ).toBe("café");
    expect(decodeCharset(Uint8Array.from([0x82, 0xa0]), "shift_jis")).toBe(
      "あ"
    );
  });

  it("reads UTF-8 labelled as ASCII as UTF-8, and real 8-bit ASCII as Windows-1252", () => {
    expect(decodeCharset(Buffer.from("café"), "us-ascii")).toBe("café");
    expect(
      decodeCharset(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), "ascii")
    ).toBe("café");
  });

  it("falls back to UTF-8 for unknown or quoted labels", () => {
    expect(decodeCharset(Buffer.from("ü"), "x-unknown-charset")).toBe("ü");
    expect(decodeCharset(Buffer.from("ü"), '"UTF-8"')).toBe("ü");
    expect(decodeCharset(Buffer.from("ü"))).toBe("ü");
  });

  it("decodes a whole text part", () => {
    expect(
      decodeTextPart(bytes("Gr=FC=DFe"), "quoted-printable", "iso-8859-1")
    ).toBe("Grüße");
  });
});
