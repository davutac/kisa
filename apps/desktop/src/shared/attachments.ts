const IMAGE_FILENAME_PATTERN =
  /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/iu;
const PDF_FILENAME_PATTERN = /\.pdf$/iu;
const FILENAME_EXTENSION_PATTERN = /\.(?<extension>[a-z\d]{1,8})$/iu;

// These are also the incoming-message data URL budgets. Composer limits must
// match them so a sent image remains renderable when the message is reopened.
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_INLINE_MESSAGE_BYTES = 8 * 1024 * 1024;

const normalizeMediaType = (mediaType: string): string =>
  mediaType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const OUTGOING_INLINE_IMAGE_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const isSupportedOutgoingInlineImageMediaType = (
  mediaType: string
): boolean =>
  OUTGOING_INLINE_IMAGE_MEDIA_TYPES.has(normalizeMediaType(mediaType));

const MEDIA_TYPE_LABELS = {
  "application/gzip": "GZIP",
  "application/msword": "DOC",
  "application/pdf": "PDF",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PPTX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "DOCX",
  "application/x-7z-compressed": "7Z",
  "application/x-rar-compressed": "RAR",
  "application/zip": "ZIP",
  "image/jpeg": "JPEG",
  "image/svg+xml": "SVG",
  "text/csv": "CSV",
  "text/plain": "TXT",
} satisfies Readonly<Record<string, string>>;

export type AttachmentPreviewKind = "image" | "pdf";

export const getAttachmentPreviewKind = (
  filename: string,
  mediaType: string
): AttachmentPreviewKind | undefined => {
  const normalizedMediaType = normalizeMediaType(mediaType);

  if (
    normalizedMediaType === "application/pdf" ||
    PDF_FILENAME_PATTERN.test(filename)
  ) {
    return "pdf";
  }

  return normalizedMediaType.startsWith("image/") ||
    IMAGE_FILENAME_PATTERN.test(filename)
    ? "image"
    : undefined;
};

export const getAttachmentTypeLabel = (
  filename: string,
  mediaType: string
): string => {
  const normalizedMediaType = normalizeMediaType(mediaType);
  const knownLabel = MEDIA_TYPE_LABELS[normalizedMediaType];

  if (knownLabel !== undefined) {
    return knownLabel;
  }

  const extension =
    FILENAME_EXTENSION_PATTERN.exec(filename)?.groups?.["extension"];

  if (extension !== undefined) {
    return extension.toUpperCase();
  }

  const [category] = normalizedMediaType.split("/", 1);

  switch (category) {
    case "audio": {
      return "AUDIO";
    }
    case "font": {
      return "FONT";
    }
    case "image": {
      return "IMAGE";
    }
    case "message": {
      return "EMAIL";
    }
    case "text": {
      return "TEXT";
    }
    case "video": {
      return "VIDEO";
    }
    default: {
      return "FILE";
    }
  }
};
