import type { GatewayThread, RawMessage } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import type {
  ComposerBody,
  ForwardInput,
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
import { toIndexText } from "./message-text";

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
): string => {
  const filename = attachment.filename.replaceAll(/["\r\n]/gu, "");

  return [
    `--${boundary}`,
    `Content-Type: ${attachment.mediaType}; name="${filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${attachment.contentId === undefined ? "attachment" : "inline"}; filename="${filename}"`,
    ...(attachment.contentId === undefined
      ? []
      : [`Content-ID: <${attachment.contentId.replaceAll(/[<>\r\n]/gu, "")}>`]),
    "",
    Buffer.from(attachment.bytes).toString("base64"),
  ].join(CRLF);
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const textToHtml = (value: string): string =>
  escapeHtml(value).replaceAll(/\r?\n/gu, "<br>");

const getComposerText = (body: ComposerBody): string =>
  body.type === "text" ? body.text : (body.text ?? toIndexText(body.html));

const getComposerHtml = (body: ComposerBody): string =>
  body.type === "html" ? body.html : `<div>${textToHtml(body.text)}</div>`;

const getOriginalBody = (
  message: RawMessagePayload | undefined
): { readonly html: string; readonly text: string } => {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  collectBodies(message?.payload, htmlParts, textParts);

  const html = htmlParts.join("\n");
  const text = textParts.join("\n");

  return {
    html: html.length > 0 ? html : `<div>${textToHtml(text)}</div>`,
    text: text.length > 0 ? text : toIndexText(html),
  };
};

const getMessage = (
  thread: GatewayThread,
  messageId: string
): RawMessagePayload | undefined => {
  const messages = thread.messages as readonly RawMessagePayload[];
  return (
    messages.find((message) => message.id === messageId) ?? messages.at(-1)
  );
};

const composeReplyBody = (
  body: ComposerBody,
  replied: RawMessagePayload | undefined
): ComposerBody => {
  if (replied === undefined) {
    return body;
  }

  const original = getOriginalBody(replied);
  const from = readHeader(replied, "from") ?? "";
  const date = readHeader(replied, "date") ?? "";
  const attribution = `On ${date}, ${from} wrote:`;
  const quotedText = original.text
    .split(/\r?\n/gu)
    .map((line) => `> ${line}`)
    .join("\n");

  return {
    html: `${getComposerHtml(body)}<div><br></div><div class="gmail_quote"><div class="gmail_attr">${escapeHtml(attribution)}<br></div><blockquote class="gmail_quote">${original.html}</blockquote></div>`,
    text: `${getComposerText(body)}\n\n${attribution}\n${quotedText}`,
    type: "html",
  };
};

const composeForwardBody = (
  body: ComposerBody,
  forwarded: RawMessagePayload | undefined
): ComposerBody => {
  if (forwarded === undefined) {
    return body;
  }

  const original = getOriginalBody(forwarded);
  const headers = [
    "---------- Forwarded message ---------",
    `From: ${readHeader(forwarded, "from") ?? ""}`,
    `Date: ${readHeader(forwarded, "date") ?? ""}`,
    `Subject: ${readHeader(forwarded, "subject") ?? ""}`,
    `To: ${readHeader(forwarded, "to") ?? ""}`,
    ...(readHeader(forwarded, "cc") === undefined
      ? []
      : [`Cc: ${readHeader(forwarded, "cc")}`]),
  ];

  return {
    html: `${getComposerHtml(body)}<div><br></div><div class="gmail_quote">${headers.map(escapeHtml).join("<br>")}<br><br>${original.html}</div>`,
    text: `${getComposerText(body)}\n\n${headers.join("\n")}\n\n${original.text}`,
    type: "html",
  };
};

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
    composeForward: (
      input: ForwardInput & {
        readonly attachments?: readonly OutgoingAttachment[];
      },
      thread: GatewayThread
    ) =>
      Effect.sync((): RawMessage => {
        const forwarded = getMessage(thread, input.forwardMessageId);
        const subject =
          forwarded === undefined
            ? ""
            : (readHeader(forwarded, "subject") ?? "");

        return {
          raw: toRaw(
            composeRaw(
              {
                subject: subject.toLowerCase().startsWith("fwd:")
                  ? subject
                  : `Fwd: ${subject}`,
                to: input.to,
                ...(input.bcc === undefined ? {} : { bcc: input.bcc }),
                ...(input.cc === undefined ? {} : { cc: input.cc }),
              },
              composeForwardBody(input.body, forwarded),
              input.attachments ?? [],
              input.forwardMessageId
            )
          ),
        };
      }),

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
        const replied = getMessage(thread, input.replyToMessageId);
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
              composeReplyBody(input.body, replied),
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
