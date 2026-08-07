import type { GatewayThread, RawMessage } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import type {
  ComposerBody,
  OutgoingAttachment,
  ReplyInput,
  SendMessageInput,
  DisplayBody,
  ThreadId,
} from "@repo/gmail/models";
import {
  GmailMessage,
  LabelId,
  GmailThread,
  HistoryId,
  Mailbox,
  MessageId,
} from "@repo/gmail/models";
import { Effect, Layer } from "effect";

import { collectAttachments, isPresent, parseMailbox } from "./gmail-payload";

interface RawPart {
  readonly body?: { readonly data?: string | null };
  readonly filename?: string | null;
  readonly headers?: readonly {
    readonly name?: string | null;
    readonly value?: string | null;
  }[];
  readonly mimeType?: string | null;
  readonly parts?: readonly RawPart[];
}

interface RawMessagePayload {
  readonly id?: string | null;
  readonly internalDate?: string | null;
  readonly labelIds?: readonly string[] | null;
  readonly payload?: RawPart;
  readonly threadId?: string | null;
}

/**
 * Anything that would make the renderer reach the network. The iframe CSP in
 * `message-body.tsx` is the enforcement boundary; this flag only drives the
 * "images are hidden" affordance, so over-reporting is harmless and
 * under-reporting is not.
 */
const REMOTE_REFERENCE_PATTERN =
  /<img[^>]+src\s*=\s*["']?https?:|<img[^>]+srcset\s*=|url\(\s*["']?https?:/iu;

const decodeBodyData = (data: string): string =>
  Buffer.from(data, "base64url").toString("utf-8");

const readHeader = (
  message: RawMessagePayload,
  name: string
): string | undefined =>
  message.payload?.headers?.find(
    (header) => header.name?.toLowerCase() === name.toLowerCase()
  )?.value ?? undefined;

const parseMailboxList = (value: string | undefined): readonly Mailbox[] => {
  if (value === undefined) {
    return [];
  }

  // Split on commas that are not inside a quoted display name.
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/u)
    .map((entry) => parseMailbox(entry))
    .filter((mailbox): mailbox is Mailbox => mailbox !== undefined);
};

const collectBodies = (
  part: RawPart | undefined,
  html: string[],
  text: string[]
): void => {
  if (part === undefined) {
    return;
  }

  // Attachment parts carry a filename; their bytes are never body content.
  if ((part.filename ?? "").trim().length === 0) {
    const data = part.body?.data;

    if (isPresent(data)) {
      if (part.mimeType === "text/html") {
        html.push(decodeBodyData(data));
      } else if (part.mimeType === "text/plain") {
        text.push(decodeBodyData(data));
      }
    }
  }

  for (const child of part.parts ?? []) {
    collectBodies(child, html, text);
  }
};

const toDisplayBody = (payload: RawPart | undefined): DisplayBody => {
  const html: string[] = [];
  const text: string[] = [];

  collectBodies(payload, html, text);

  const joinedHtml = html.join("\n");

  if (joinedHtml.length > 0) {
    return {
      hasBlockedRemoteImages: REMOTE_REFERENCE_PATTERN.test(joinedHtml),
      // Not transformed: the renderer isolates message HTML in a sandboxed
      // iframe under `default-src 'none'`, which is what actually contains it.
      sanitizedHtml: joinedHtml,
      type: "html",
    };
  }

  return { text: text.join("\n"), type: "text" };
};

const toGmailMessage = (
  threadId: ThreadId,
  message: RawMessagePayload
): GmailMessage | undefined => {
  if (!isPresent(message.id)) {
    return undefined;
  }

  const from = parseMailbox(readHeader(message, "from") ?? "");
  const replyTo = parseMailbox(readHeader(message, "reply-to") ?? "");

  return new GmailMessage({
    attachments: collectAttachments(message.id, message.payload),
    bcc: parseMailboxList(readHeader(message, "bcc")),
    body: toDisplayBody(message.payload),
    cc: parseMailboxList(readHeader(message, "cc")),
    from: from ?? new Mailbox({ address: "unknown@invalid" }),
    id: MessageId.make(message.id),
    labelIds: (message.labelIds ?? []).map((id) => LabelId.make(id)),
    sentAt: message.internalDate ?? "0",
    subject: readHeader(message, "subject") ?? "",
    threadId,
    to: parseMailboxList(readHeader(message, "to")),
    ...(replyTo === undefined ? {} : { replyTo }),
  });
};

const formatMailbox = (mailbox: Mailbox): string =>
  mailbox.name === undefined || mailbox.name.length === 0
    ? mailbox.address
    : `"${mailbox.name.replaceAll('"', "")}" <${mailbox.address}>`;

const formatMailboxList = (mailboxes: readonly Mailbox[]): string =>
  mailboxes.map(formatMailbox).join(", ");

/** RFC 2047 encoded-word; header values must stay 7-bit. */
const encodeHeaderValue = (value: string): string =>
  // oxlint-disable-next-line no-control-regex
  /^[ -~]*$/u.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;

const CRLF = "\r\n";

const makeBoundary = (label: string, seed: string): string =>
  `----=_${label}_${Buffer.from(seed).toString("hex").slice(0, 24)}`;

const bodyParts = (body: ComposerBody, boundary: string): string => {
  if (body.type === "text") {
    return [
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(body.text, "utf-8").toString("base64"),
    ].join(CRLF);
  }

  const alternatives = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body.text ?? "", "utf-8").toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body.html, "utf-8").toString("base64"),
    `--${boundary}--`,
  ];

  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    ...alternatives,
  ].join(CRLF);
};

const attachmentPart = (
  attachment: OutgoingAttachment,
  boundary: string
): string =>
  [
    `--${boundary}`,
    `Content-Type: ${attachment.mediaType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "",
    Buffer.from(attachment.bytes).toString("base64"),
  ].join(CRLF);

interface ComposeHeaders {
  readonly bcc?: readonly Mailbox[];
  readonly cc?: readonly Mailbox[];
  readonly inReplyTo?: string;
  readonly references?: string;
  readonly subject: string;
  readonly to: readonly Mailbox[];
}

const composeRaw = (
  headers: ComposeHeaders,
  body: ComposerBody,
  attachments: readonly OutgoingAttachment[],
  seed: string
): string => {
  const alternativeBoundary = makeBoundary("alt", `${seed}-alt`);
  const mixedBoundary = makeBoundary("mix", `${seed}-mix`);
  const headerLines = [
    `To: ${formatMailboxList(headers.to)}`,
    `Subject: ${encodeHeaderValue(headers.subject)}`,
    "MIME-Version: 1.0",
    ...(headers.cc === undefined || headers.cc.length === 0
      ? []
      : [`Cc: ${formatMailboxList(headers.cc)}`]),
    ...(headers.bcc === undefined || headers.bcc.length === 0
      ? []
      : [`Bcc: ${formatMailboxList(headers.bcc)}`]),
    ...(headers.inReplyTo === undefined
      ? []
      : [`In-Reply-To: ${headers.inReplyTo}`]),
    ...(headers.references === undefined
      ? []
      : [`References: ${headers.references}`]),
  ];

  if (attachments.length === 0) {
    return [...headerLines, bodyParts(body, alternativeBoundary)].join(CRLF);
  }

  return [
    ...headerLines,
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    "",
    `--${mixedBoundary}`,
    bodyParts(body, alternativeBoundary),
    ...attachments.map((attachment) =>
      attachmentPart(attachment, mixedBoundary)
    ),
    `--${mixedBoundary}--`,
  ].join(CRLF);
};

const toRaw = (raw: string): string =>
  Buffer.from(raw, "utf-8").toString("base64url");

export const GmailMimeLive = Layer.succeed(
  GmailMime,
  GmailMime.of({
    composeMessage: (input: SendMessageInput) =>
      Effect.sync((): RawMessage => ({
        raw: toRaw(
          composeRaw(
            {
              subject: input.subject,
              to: input.to,
              ...(input.bcc === undefined ? {} : { bcc: input.bcc }),
              ...(input.cc === undefined ? {} : { cc: input.cc }),
            },
            input.body,
            input.attachments ?? [],
            input.accountId
          )
        ),
      })),

    composeReply: (input: ReplyInput, thread: GatewayThread) =>
      Effect.sync((): RawMessage => {
        const messages = thread.messages as readonly RawMessagePayload[];
        const replied =
          messages.find((message) => message.id === input.replyToMessageId) ??
          messages.at(-1);
        const messageIdHeader =
          replied === undefined ? undefined : readHeader(replied, "message-id");
        const existingReferences =
          replied === undefined ? undefined : readHeader(replied, "references");
        const subject =
          replied === undefined ? "" : (readHeader(replied, "subject") ?? "");
        const to =
          input.to ??
          (replied === undefined
            ? []
            : parseMailboxList(
                readHeader(replied, "reply-to") ?? readHeader(replied, "from")
              ));

        return {
          raw: toRaw(
            composeRaw(
              {
                subject: subject.toLowerCase().startsWith("re:")
                  ? subject
                  : `Re: ${subject}`,
                to,
                ...(input.bcc === undefined ? {} : { bcc: input.bcc }),
                ...(input.cc === undefined ? {} : { cc: input.cc }),
                ...(messageIdHeader === undefined
                  ? {}
                  : {
                      inReplyTo: messageIdHeader,
                      references:
                        existingReferences === undefined
                          ? messageIdHeader
                          : `${existingReferences} ${messageIdHeader}`,
                    }),
              },
              input.body,
              input.attachments ?? [],
              input.threadId
            )
          ),
          threadId: input.threadId,
        };
      }),

    parseThread: (thread: GatewayThread) =>
      Effect.sync(() => {
        const messages = (thread.messages as readonly RawMessagePayload[])
          .map((message) => toGmailMessage(thread.id, message))
          .filter((message): message is GmailMessage => message !== undefined);

        return new GmailThread({
          historyId: HistoryId.make(thread.historyId),
          id: thread.id,
          labelIds: thread.labelIds.map((id) => LabelId.make(id)),
          messages,
        });
      }),
  })
);
