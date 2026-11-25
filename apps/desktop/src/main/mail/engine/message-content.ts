import { promisify } from "node:util";
import { gzip } from "node:zlib";

import type {
  StoredMailAttachment,
  StoredMailHeader,
} from "@repo/database/schemas";
import type { DialectKind } from "@repo/mail/dialects";
import type { MessagePart } from "@repo/mail/mime-structure";
import type { MessageBodies } from "@repo/mail/store";

import { toIndexText } from "../message-text";
import { isAuthenticatedSender } from "../sender-authentication";

const gzipAsync = promisify(gzip);

/** Bumped when the stored representation of a body changes. */
export const MAIL_BODY_SCHEMA_VERSION = 1;

const SNIPPET_LENGTH = 200;

/**
 * Anything that would make the renderer reach the network. The frame policy
 * in `renderer/src/mail/email-frame.ts` is the enforcement boundary, and the
 * renderer runs its own scan before offering to show images, so this stored
 * flag only has to be close. Tag scans stop at the next `<`, which keeps a
 * body of unclosed `<img` tags to one pass.
 */
const REMOTE_REFERENCE_PATTERN =
  /<img[^<>]+src\s*=\s*["']?https?:|<img[^<>]+srcset\s*=|url\(\s*["']?https?:/iu;

/** The list snippet: the start of the message's text, whitespace collapsed. */
export const toSnippet = (text: string): string =>
  text.replaceAll(/\s+/gu, " ").trim().slice(0, SNIPPET_LENGTH);

/**
 * Only Gmail's receiving servers are trusted to have authenticated a sender:
 * the same header in mail delivered elsewhere was written by the sender.
 * Other providers report unauthenticated until their header is verified.
 */
const authenticateSender = (
  dialect: DialectKind,
  fromAddress: string,
  headers: readonly StoredMailHeader[]
): boolean =>
  dialect === "gmail" && isAuthenticatedSender(fromAddress, headers);

const toStoredAttachment = (part: MessagePart): StoredMailAttachment => ({
  contentId: part.contentId,
  disposition: part.disposition,
  encoding: part.encoding,
  filename: part.filename,
  mediaType: part.mimeType,
  section: part.section,
  size: part.size,
});

/** A listed attachment, as opposed to an unnamed inline image. */
export const isListedAttachment = (attachment: StoredMailAttachment): boolean =>
  attachment.filename.length > 0 || attachment.disposition === "attachment";

export interface PreparedBody {
  readonly attachments: readonly StoredMailAttachment[] | null;
  readonly bodyHtml: Buffer | null;
  readonly bodyState: "failed" | "ready";
  readonly bodyText: string | null;
  readonly hasAttachments: boolean;
  readonly hasBlockedRemoteImages: boolean;
  readonly headers: readonly StoredMailHeader[];
  readonly messageId: string;
  readonly senderAuthenticated: boolean;
  readonly snippet: string;
}

/**
 * Turns fetched text parts into what the cache stores: gzipped HTML, a plain
 * text rendition for search (most mail has no `text/plain` part), and the
 * list snippet. Message HTML is stored as received; the renderer's isolated
 * frame is what makes it safe to show.
 */
export const prepareBody = async (
  body: MessageBodies,
  context: { readonly dialect: DialectKind; readonly fromAddress: string }
): Promise<PreparedBody> => {
  const headers = body.headers.map(({ name, value }) => ({ name, value }));

  if (body.failed === true) {
    return {
      attachments: null,
      bodyHtml: null,
      bodyState: "failed",
      bodyText: null,
      hasAttachments: false,
      hasBlockedRemoteImages: false,
      headers,
      messageId: body.messageId,
      senderAuthenticated: false,
      snippet: "",
    };
  }

  const attachments = (body.structure?.attachments ?? []).map(
    toStoredAttachment
  );

  const bodyText =
    body.html === undefined ? (body.text ?? "") : toIndexText(body.html);

  return {
    attachments,
    bodyHtml:
      body.html === undefined
        ? null
        : await gzipAsync(Buffer.from(body.html, "utf-8")),
    bodyState: "ready",
    bodyText,
    hasAttachments: attachments.some(isListedAttachment),
    hasBlockedRemoteImages:
      body.html !== undefined && REMOTE_REFERENCE_PATTERN.test(body.html),
    headers,
    messageId: body.messageId,
    senderAuthenticated: authenticateSender(
      context.dialect,
      context.fromAddress,
      headers
    ),
    snippet: toSnippet(bodyText),
  };
};
