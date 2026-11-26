import { crc32, deflateSync } from "node:zlib";

// Small real files for the demo mailbox, drawn here so that opening an
// attachment shows something and the repository carries no binary samples.

const escapePdfText = (text: string): string =>
  text.replaceAll(/[()\\]/gu, String.raw`\$&`);

/** A one-page PDF: a heading and lines of text under it, in ASCII. */
export const demoPdf = (
  heading: string,
  lines: readonly string[]
): Uint8Array => {
  const content = [
    "BT",
    "/F1 22 Tf",
    "72 760 Td",
    `(${escapePdfText(heading)}) Tj`,
    "/F1 11 Tf",
    "0 -14 Td",
    ...lines.flatMap((line) => ["0 -20 Td", `(${escapePdfText(line)}) Tj`]),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let document = "%PDF-1.4\n";
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(document.length);
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }

  const xrefOffset = document.length;

  document += [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
    "",
  ].join("\n");

  return Buffer.from(document, "latin1");
};

type Rgb = readonly [red: number, green: number, blue: number];

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);

  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(body));

  return Buffer.concat([length, body, checksum]);
};

/** An opaque PNG whose pixels `paint` chooses. */
const demoPng = (
  width: number,
  height: number,
  paint: (x: number, y: number) => Rgb
): Uint8Array => {
  // Each row is a filter byte, then three bytes a pixel.
  const stride = width * 3 + 1;
  const pixels = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(paint(x, y), y * stride + 1 + x * 3);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  // Eight bits a channel, truecolour, no interlace.
  header.set([8, 2, 0, 0, 0], 8);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const PAPER: Rgb = [246, 242, 234];

const SWATCHES: readonly Rgb[] = [
  [31, 58, 77],
  [214, 122, 82],
  [236, 201, 143],
  [118, 148, 131],
  [58, 46, 51],
  [173, 86, 72],
  [222, 214, 198],
  [78, 105, 122],
];

/** A colour board: two rows of four swatches on paper. */
export const demoSwatchBoard = (): Uint8Array => {
  const tile = 140;
  const gap = 16;

  return demoPng(4 * tile + 5 * gap, 2 * tile + 3 * gap, (x, y) => {
    const column = Math.floor((x - gap) / (tile + gap));
    const row = Math.floor((y - gap) / (tile + gap));

    const isInTile =
      x >= gap &&
      y >= gap &&
      (x - gap) % (tile + gap) < tile &&
      (y - gap) % (tile + gap) < tile;

    return (isInTile ? SWATCHES[row * 4 + column] : undefined) ?? PAPER;
  });
};

const RIDGES: readonly {
  readonly base: number;
  readonly color: Rgb;
  readonly height: number;
  readonly width: number;
}[] = [
  { base: 0.46, color: [142, 164, 181], height: 0.1, width: 210 },
  { base: 0.6, color: [88, 119, 133], height: 0.09, width: 150 },
  { base: 0.76, color: [44, 74, 78], height: 0.07, width: 95 },
];

/** A mountain view: a dawn sky over three ridges. */
export const demoLandscape = (): Uint8Array => {
  const width = 720;
  const height = 440;

  return demoPng(width, height, (x, y) => {
    const level = y / height;

    const ridge = RIDGES.findLast(
      (candidate) =>
        level >
        candidate.base +
          candidate.height * Math.sin(x / candidate.width + candidate.width)
    );

    if (ridge !== undefined) {
      return ridge.color;
    }

    return [
      Math.round(248 - 70 * level),
      Math.round(214 - 20 * level),
      Math.round(178 + 40 * level),
    ];
  });
};
