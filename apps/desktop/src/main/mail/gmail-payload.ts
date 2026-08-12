import {
  AttachmentId,
  AttachmentSummary,
  Mailbox,
  MessageId,
} from "@repo/gmail/models";

/**
 * Structural shapes for Gmail message payloads, shared by the gateway (which
 * sees `gmail_v1.Schema$*`) and the MIME service (which sees the same values
 * passed opaquely through `GatewayThread.messages`). Kept structural so both
 * callers satisfy them without importing each other's types.
 */
export interface PayloadHeader {
  readonly name?: string | null;
  readonly value?: string | null;
}

export interface PayloadPart {
  readonly body?: {
    readonly attachmentId?: string | null;
    readonly data?: string | null;
    readonly size?: number | null;
  };
  readonly filename?: string | null;
  readonly headers?: readonly PayloadHeader[];
  readonly mimeType?: string | null;
  readonly parts?: readonly PayloadPart[];
}

/** `@googleapis/gmail` types every field as `T | null | undefined`. */
export const isPresent = <A>(value: A | null | undefined): value is A =>
  value !== null && value !== undefined;

const MAILBOX_PATTERN =
  /^\s*(?:"?(?<name>[^"<]*?)"?\s*)?<(?<angle>[^>]+)>\s*$|^\s*(?<bare>[^\s<>]+@[^\s<>]+)\s*$/u;

export const parseMailbox = (value: string): Mailbox | undefined => {
  const groups = MAILBOX_PATTERN.exec(value)?.groups;
  const address = groups?.angle ?? groups?.bare;

  if (address === undefined || address.trim().length === 0) {
    return undefined;
  }

  const name = groups?.name?.trim();

  return new Mailbox({
    address: address.trim(),
    name: name === undefined || name.length === 0 ? undefined : name,
  });
};

export const hasAttachmentPart = (part: PayloadPart): boolean =>
  (part.filename ?? "").trim().length > 0 ||
  (part.parts ?? []).some(hasAttachmentPart);

export const collectAttachments = (
  messageId: string,
  part: PayloadPart | undefined
): readonly AttachmentSummary[] => {
  if (part === undefined) {
    return [];
  }

  const filename = (part.filename ?? "").trim();
  const attachmentId = part.body?.attachmentId;
  const nested = (part.parts ?? []).flatMap((child) =>
    collectAttachments(messageId, child)
  );

  if (filename.length === 0 || !isPresent(attachmentId)) {
    return nested;
  }

  const contentId = part.headers
    ?.find((header) => header.name?.toLowerCase() === "content-id")
    ?.value?.replaceAll(/^<|>$/gu, "");

  return [
    new AttachmentSummary({
      attachmentId: AttachmentId.make(attachmentId),
      contentId:
        isPresent(contentId) && contentId.length > 0 ? contentId : undefined,
      filename,
      mediaType: part.mimeType ?? "application/octet-stream",
      messageId: MessageId.make(messageId),
      size: part.body?.size ?? 0,
    }),
    ...nested,
  ];
};
