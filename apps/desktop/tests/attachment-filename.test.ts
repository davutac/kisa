import { describe, expect, it } from "vitest";

import {
  sanitizeAttachmentFilename,
  toDisplayedAttachment,
} from "../src/main/mail/attachment-filename";

describe(sanitizeAttachmentFilename, () => {
  it("removes path traversal and reserved filename forms", () => {
    expect(sanitizeAttachmentFilename("../../private/report.pdf")).toBe(
      "report.pdf"
    );
    expect(sanitizeAttachmentFilename("..／private／report?.pdf")).toBe(
      "report.pdf"
    );
    expect(sanitizeAttachmentFilename("CON.txt")).toBe("_CON.txt");
    expect(sanitizeAttachmentFilename("bad\u0000name. ")).toBe("badname");
  });
});

describe(toDisplayedAttachment, () => {
  it("shows the name Save As would write, without reordering characters", () => {
    expect(
      toDisplayedAttachment({
        filename: "invoice‮fdp.scr",
        mediaType: "application/pdf",
        messageId: "message-1",
        size: 10,
      })
    ).toStrictEqual({
      filename: "invoicefdp.scr",
      mediaType: "application/pdf",
      messageId: "message-1",
      size: 10,
    });
  });
});
