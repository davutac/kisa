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
  readonly partId?: string | null;
  readonly parts?: readonly PayloadPart[];
}

/** `@googleapis/gmail` types every field as `T | null | undefined`. */
export const isPresent = <A>(value: A | null | undefined): value is A =>
  value !== null && value !== undefined;

const BARE_ADDRESS_EXCLUDED_PATTERN = /[\s<>]/u;

/**
 * Reads the display name of `Name <address>`: an optionally quoted run with no
 * quote inside it. `undefined` means the name is malformed, not absent.
 */
const parseDisplayName = (prefix: string): string | undefined => {
  let name = prefix.trimEnd();

  if (name.startsWith('"')) {
    name = name.slice(1);
  }

  if (name.endsWith('"')) {
    name = name.slice(0, -1);
  }

  return name.includes('"') ? undefined : name.trim();
};

/**
 * Parses `Name <address>`, `"Name" <address>`, or a bare `local@domain`.
 *
 * Headers are sender-controlled, so this reads the string by position. A single
 * pattern for the same grammar lets its optional name and the whitespace around
 * it each claim the same spaces, and a few kilobytes of them stall the main
 * process.
 */
export const parseMailbox = (value: string): Mailbox | undefined => {
  const mailbox = value.trim();
  const open = mailbox.indexOf("<");

  if (open === -1) {
    return BARE_ADDRESS_EXCLUDED_PATTERN.test(mailbox) ||
      !mailbox.slice(1, -1).includes("@")
      ? undefined
      : new Mailbox({ address: mailbox, name: undefined });
  }

  // The address runs from the first `<` to the first `>` after it, which has
  // to end the header.
  if (mailbox.indexOf(">", open + 1) !== mailbox.length - 1) {
    return undefined;
  }

  const address = mailbox.slice(open + 1, -1).trim();
  const name = parseDisplayName(mailbox.slice(0, open));

  if (address.length === 0 || name === undefined) {
    return undefined;
  }

  return new Mailbox({
    address,
    name: name.length === 0 ? undefined : name,
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
      partId: part.partId ?? undefined,
      size: part.body?.size ?? 0,
    }),
    ...nested,
  ];
};
