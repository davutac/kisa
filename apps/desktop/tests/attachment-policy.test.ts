import { describe, expect, it } from "vitest";

import {
  getAttachmentPreviewKind,
  getAttachmentTypeLabel,
} from "../src/shared/attachments";

describe(getAttachmentPreviewKind, () => {
  it("previews image media types and common image filenames", () => {
    expect(getAttachmentPreviewKind("photo.bin", "image/jpeg")).toBe("image");
    expect(
      getAttachmentPreviewKind("scan.WEBP", "application/octet-stream")
    ).toBe("image");
  });

  it("previews PDFs identified by media type or filename", () => {
    expect(getAttachmentPreviewKind("report.bin", "application/pdf")).toBe(
      "pdf"
    );
    expect(
      getAttachmentPreviewKind("report.PDF", "application/octet-stream")
    ).toBe("pdf");
  });

  it("sends every other attachment through Save As", () => {
    expect(
      getAttachmentPreviewKind(
        "worksheet.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBeUndefined();
  });
});

describe(getAttachmentTypeLabel, () => {
  it("prefers authoritative media types", () => {
    expect(getAttachmentTypeLabel("report.bin", "application/pdf")).toBe("PDF");
    expect(
      getAttachmentTypeLabel(
        "budget.bin",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe("XLSX");
  });

  it("falls back to the filename extension or media category", () => {
    expect(
      getAttachmentTypeLabel("archive.ZIP", "application/octet-stream")
    ).toBe("ZIP");
    expect(getAttachmentTypeLabel("photo", "image/x-custom")).toBe("IMAGE");
    expect(
      getAttachmentTypeLabel("attachment", "application/octet-stream")
    ).toBe("FILE");
  });
});
