// Inline images travel inside the message as attachments and the body points at
// them with `cid:` urls. Nothing in Chromium resolves that scheme, so the bytes
// are fetched here and handed to the renderer as data urls. Unlike remote
// images this costs the reader nothing in privacy: the parts are already part
// of the message, so displaying them tells the sender nothing.

import {
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_MESSAGE_BYTES,
} from "../../shared/attachments";

const CID_URL_PATTERN = /cid:(?<id>[^"'\s)>]+)/giu;
const IMAGE_MEDIA_TYPE_PATTERN = /^image\/[\w.+-]+$/iu;

export interface InlineImageCandidate {
  readonly contentId?: string;
  readonly mediaType: string;
  readonly size: number;
}

type ReferencedCandidate<A extends InlineImageCandidate> = A & {
  readonly contentId: string;
};

// Senders write the same content id in different spellings, and the body may
// percent-encode it, so both sides are folded before they are compared.
export const normalizeContentId = (contentId: string): string => {
  const trimmed = contentId.trim().replaceAll(/^<|>$/gu, "");

  try {
    return decodeURIComponent(trimmed).toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
};

const hasContentId = <A extends InlineImageCandidate>(
  candidate: A
): candidate is ReferencedCandidate<A> =>
  candidate.contentId !== undefined && candidate.contentId.trim().length > 0;

export const collectReferencedContentIds = (
  html: string
): ReadonlySet<string> => {
  const contentIds = new Set<string>();

  for (const match of html.matchAll(CID_URL_PATTERN)) {
    const contentId = match.groups?.id;

    if (contentId !== undefined) {
      contentIds.add(normalizeContentId(contentId));
    }
  }

  return contentIds;
};

/**
 * Picks the attachments worth fetching for a body: images the body actually
 * points at, small enough to travel as text, until the message budget runs out.
 */
export const selectInlineImages = <A extends InlineImageCandidate>(
  html: string,
  attachments: readonly A[]
): readonly ReferencedCandidate<A>[] => {
  const referenced = collectReferencedContentIds(html);

  if (referenced.size === 0) {
    return [];
  }

  const selected: ReferencedCandidate<A>[] = [];
  const seen = new Set<string>();
  let budget = MAX_INLINE_MESSAGE_BYTES;

  for (const attachment of attachments.filter(hasContentId)) {
    const contentId = normalizeContentId(attachment.contentId);

    if (
      seen.has(contentId) ||
      !referenced.has(contentId) ||
      !IMAGE_MEDIA_TYPE_PATTERN.test(attachment.mediaType) ||
      attachment.size > MAX_INLINE_IMAGE_BYTES ||
      attachment.size > budget
    ) {
      continue;
    }

    seen.add(contentId);
    budget -= attachment.size;
    selected.push(attachment);
  }

  return selected;
};

export const toImageDataUrl = (
  mediaType: string,
  bytes: Uint8Array
): string | undefined =>
  IMAGE_MEDIA_TYPE_PATTERN.test(mediaType)
    ? `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`
    : undefined;

/**
 * Points the body at the images that were fetched. References that were not
 * fetched keep their `cid:` url, which stays as dead as it was before.
 */
export const inlineImageDataUrls = (
  html: string,
  dataUrlsByContentId: ReadonlyMap<string, string>
): string =>
  dataUrlsByContentId.size === 0
    ? html
    : html.replaceAll(CID_URL_PATTERN, (reference, contentId: string) => {
        const dataUrl = dataUrlsByContentId.get(normalizeContentId(contentId));

        return dataUrl ?? reference;
      });
