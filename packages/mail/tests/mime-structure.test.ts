import { describe, expect, it } from "vitest";

import {
  DEFAULT_MIME_LIMITS,
  planMessageStructure,
} from "../src/mime-structure";
import type { BodyStructureNode } from "../src/mime-structure";

const text = (
  part: string,
  type: string,
  extra: Partial<BodyStructureNode> = {}
): BodyStructureNode => ({
  encoding: "quoted-printable",
  parameters: { charset: "utf-8" },
  part,
  size: 1000,
  type,
  ...extra,
});

describe(planMessageStructure, () => {
  it("fetches the HTML rendition of an alternative and leaves plain text on the server", () => {
    const structure = planMessageStructure({
      childNodes: [
        {
          childNodes: [text("1.1", "text/plain"), text("1.2", "text/html")],
          part: "1",
          type: "multipart/alternative",
        },
        {
          disposition: "attachment",
          dispositionParameters: { filename: " report.pdf " },
          encoding: "base64",
          part: "2",
          size: 50_000,
          type: "application/pdf",
        },
      ],
      type: "multipart/mixed",
    });

    expect(structure.bodies.map((part) => part.section)).toStrictEqual(["1.2"]);
    expect(structure.attachments).toStrictEqual([
      expect.objectContaining({
        filename: "report.pdf",
        kind: "attachment",
        mimeType: "application/pdf",
        section: "2",
        size: 50_000,
      }),
    ]);
    expect(structure.root.section).toBe("");
    expect(structure.truncated).toBeFalsy();
  });

  it("keeps plain text when there is no HTML sibling", () => {
    const structure = planMessageStructure({
      childNodes: [text("1", "text/plain"), text("2", "text/plain")],
      type: "multipart/alternative",
    });

    expect(structure.bodies.map((part) => part.section)).toStrictEqual([
      "1",
      "2",
    ]);
  });

  it("numbers a single-part message as section 1", () => {
    const structure = planMessageStructure({ size: 10, type: "TEXT/PLAIN" });

    expect(structure.bodies).toStrictEqual([
      expect.objectContaining({ mimeType: "text/plain", section: "1" }),
    ]);
  });

  it("treats inline images and named text as attachments, keeping the content id", () => {
    const structure = planMessageStructure({
      childNodes: [
        text("1", "text/html"),
        { id: "<logo@x>", part: "2", size: 10, type: "image/png" },
        text("3", "text/plain", { parameters: { name: "notes.txt" } }),
      ],
      type: "multipart/related",
    });

    expect(structure.bodies.map((part) => part.section)).toStrictEqual(["1"]);
    expect(structure.attachments).toStrictEqual([
      expect.objectContaining({
        contentId: "logo@x",
        filename: "",
        section: "2",
      }),
      expect.objectContaining({ filename: "notes.txt", section: "3" }),
    ]);
  });

  it("offers text over the size limits as an attachment", () => {
    const structure = planMessageStructure(
      {
        childNodes: [
          text("1", "text/html", { size: 60 }),
          text("2", "text/html", { size: 60 }),
        ],
        type: "multipart/mixed",
      },
      { ...DEFAULT_MIME_LIMITS, maxTextBytes: 100, maxTextPartBytes: 100 }
    );

    expect(structure.bodies.map((part) => part.section)).toStrictEqual(["1"]);
    expect(structure.attachments.map((part) => part.section)).toStrictEqual([
      "2",
    ]);
    expect(structure.truncated).toBeTruthy();
  });

  it("stops at the part and depth limits", () => {
    let deep: BodyStructureNode = text("x", "text/plain");
    for (let depth = 0; depth < 30; depth += 1) {
      deep = { childNodes: [deep], type: "multipart/mixed" };
    }
    expect(planMessageStructure(deep).truncated).toBeTruthy();

    const wide = planMessageStructure(
      {
        childNodes: Array.from({ length: 20 }, (_, index) =>
          text(String(index + 1), "image/png")
        ),
        type: "multipart/mixed",
      },
      { ...DEFAULT_MIME_LIMITS, maxParts: 5 }
    );
    expect(wide.attachments).toHaveLength(4);
    expect(wide.truncated).toBeTruthy();
  });

  it("does not descend into an attached message", () => {
    const structure = planMessageStructure({
      childNodes: [
        text("1", "text/plain"),
        {
          childNodes: [text("2", "text/html")],
          part: "2",
          size: 4000,
          type: "message/rfc822",
        },
      ],
      type: "multipart/mixed",
    });

    expect(structure.bodies.map((part) => part.section)).toStrictEqual(["1"]);
    expect(structure.attachments).toStrictEqual([
      expect.objectContaining({ mimeType: "message/rfc822", section: "2" }),
    ]);
  });
});
