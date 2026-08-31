import { Node } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Predicate } from "effect";

import {
  isSupportedOutgoingInlineImageMediaType,
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_MESSAGE_BYTES,
} from "@/shared/attachments";
import type { MailDraftAttachment } from "@/shared/ipc/mail";

const CID_REFERENCE = /\bsrc=["']cid:(?<contentId>[^"']+)["']/giu;

export interface ComposerInlineImage {
  readonly contentId: string;
  readonly filename: string;
}

interface ComposerInlineImageOptions {
  readonly getPreviewUrl: (contentId: string) => string | null;
  readonly loadPreviewUrl: (contentId: string) => Promise<string | null>;
}

const NO_INLINE_IMAGE_PREVIEW = (): null => null;
const NO_INLINE_IMAGE_PREVIEW_LOAD = (): Promise<null> => Promise.resolve(null);

const readStringAttribute = (node: ProseMirrorNode, name: string): string => {
  const value: unknown = node.attrs[name];
  return Predicate.isString(value) ? value : "";
};

const contentIdFromSource = (source: string | null): string =>
  source?.startsWith("cid:") === true ? source.slice(4) : "";

const loadImageElementPreview = async (
  image: HTMLImageElement,
  contentId: string,
  loadPreviewUrl: ComposerInlineImageOptions["loadPreviewUrl"]
): Promise<void> => {
  try {
    const loadedPreviewUrl = await loadPreviewUrl(contentId);
    if (loadedPreviewUrl === null || image.dataset.contentId !== contentId) {
      return;
    }
    image.classList.remove("composer-inline-image-missing");
    image.src = loadedPreviewUrl;
  } catch {
    // The attachment controller reports preview failures to the user.
  }
};

const updateImageElement = (
  image: HTMLImageElement,
  node: ProseMirrorNode,
  getPreviewUrl: ComposerInlineImageOptions["getPreviewUrl"],
  loadPreviewUrl: ComposerInlineImageOptions["loadPreviewUrl"]
): void => {
  const contentId = readStringAttribute(node, "contentId");
  const filename = readStringAttribute(node, "filename");
  image.alt = filename;
  image.dataset.contentId = contentId;
  image.draggable = true;
  const previewUrl = getPreviewUrl(contentId);
  image.classList.toggle("composer-inline-image-missing", previewUrl === null);
  if (previewUrl === null) {
    image.removeAttribute("src");
    if (contentId.length > 0) {
      void loadImageElementPreview(image, contentId, loadPreviewUrl);
    }
  } else {
    image.src = previewUrl;
  }
};

export const ComposerInlineImageNode = Node.create<ComposerInlineImageOptions>({
  addAttributes() {
    return {
      contentId: {
        default: "",
        parseHTML: (element) =>
          contentIdFromSource(element.getAttribute("src")),
      },
      filename: {
        default: "image",
        parseHTML: (element) => element.getAttribute("alt") ?? "image",
      },
    };
  },
  addNodeView() {
    const { getPreviewUrl, loadPreviewUrl } = this.options;

    return ({ node }) => {
      const image = document.createElement("img");
      image.className = "composer-inline-image";
      updateImageElement(image, node, getPreviewUrl, loadPreviewUrl);

      return {
        dom: image,
        update: (nextNode) => {
          if (nextNode.type !== node.type) {
            return false;
          }
          updateImageElement(image, nextNode, getPreviewUrl, loadPreviewUrl);
          return true;
        },
      };
    };
  },
  addOptions() {
    return {
      getPreviewUrl: NO_INLINE_IMAGE_PREVIEW,
      loadPreviewUrl: NO_INLINE_IMAGE_PREVIEW_LOAD,
    };
  },
  atom: true,
  draggable: true,
  group: "inline",
  inline: true,
  name: "composerInlineImage",
  parseHTML() {
    return [{ tag: 'img[src^="cid:"]' }];
  },
  renderHTML({ node }) {
    const contentId = readStringAttribute(node, "contentId");
    const filename = readStringAttribute(node, "filename");

    return [
      "img",
      {
        alt: filename,
        src: `cid:${contentId}`,
      },
    ];
  },
  renderText({ node }) {
    return `[Image: ${readStringAttribute(node, "filename")}]`;
  },
  selectable: true,
});

export const collectComposerInlineContentIds = (
  html: string
): ReadonlySet<string> => {
  const contentIds = new Set<string>();
  for (const match of html.matchAll(CID_REFERENCE)) {
    const contentId = match.groups?.contentId;
    if (contentId !== undefined) {
      contentIds.add(contentId);
    }
  }
  return contentIds;
};

export const getActiveComposerAttachments = (
  attachments: readonly MailDraftAttachment[],
  referencedContentIds: ReadonlySet<string>
): readonly MailDraftAttachment[] =>
  attachments.filter(
    ({ contentId }) =>
      contentId === undefined || referencedContentIds.has(contentId)
  );

export const getRetainedComposerInlineBytes = (
  attachments: readonly MailDraftAttachment[]
): number => {
  let total = 0;
  for (const attachment of attachments) {
    if (attachment.contentId !== undefined) {
      total += attachment.size;
    }
  }
  return total;
};

export const getComposerAttachmentBytes = (
  attachments: readonly MailDraftAttachment[]
): number => {
  let total = 0;
  for (const attachment of attachments) {
    total += attachment.size;
  }
  return total;
};

export const assignComposerInlineContentIds = (
  attachments: readonly MailDraftAttachment[],
  existingInlineBytes: number,
  makeContentId: () => string
): readonly MailDraftAttachment[] => {
  let remainingInlineBytes = Math.max(
    MAX_INLINE_MESSAGE_BYTES - existingInlineBytes,
    0
  );

  return attachments.map((attachment) => {
    if (
      isSupportedOutgoingInlineImageMediaType(attachment.mediaType) &&
      attachment.size <= MAX_INLINE_IMAGE_BYTES &&
      attachment.size <= remainingInlineBytes
    ) {
      remainingInlineBytes -= attachment.size;
      return { ...attachment, contentId: makeContentId() };
    }
    return attachment;
  });
};

export const partitionComposerFiles = (
  files: readonly File[],
  existingInlineBytes = 0
) => {
  const inlineImages: File[] = [];
  const attachments: File[] = [];
  let remainingInlineBytes = Math.max(
    MAX_INLINE_MESSAGE_BYTES - existingInlineBytes,
    0
  );

  for (const file of files) {
    if (
      isSupportedOutgoingInlineImageMediaType(file.type) &&
      file.size <= MAX_INLINE_IMAGE_BYTES &&
      file.size <= remainingInlineBytes
    ) {
      inlineImages.push(file);
      remainingInlineBytes -= file.size;
    } else {
      attachments.push(file);
    }
  }

  return { attachments, inlineImages };
};
