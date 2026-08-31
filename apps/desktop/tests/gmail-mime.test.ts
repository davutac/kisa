import { describe, expect, it } from "@effect/vitest";
import type { GatewayThread } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import {
  AccountId,
  HistoryId,
  Mailbox,
  MessageId,
  ThreadId,
} from "@repo/gmail/models";
import { Effect } from "effect";

import { GmailMimeLive } from "../src/main/mail/gmail-mime";

const encodeBody = (value: string): string =>
  Buffer.from(value, "utf-8").toString("base64url");

const testThread = {
  historyId: HistoryId.make("1"),
  id: ThreadId.make("thread-1"),
  labelIds: ["INBOX"],
  messages: [
    {
      id: "message-1",
      internalDate: "1700000000000",
      payload: {
        headers: [
          { name: "Message-ID", value: "<message-1@example.com>" },
          { name: "References", value: "<earlier@example.com>" },
          { name: "From", value: "Alice <alice@example.com>" },
          { name: "Date", value: "Tue, 14 Nov 2023 22:13:20 +0000" },
          { name: "Subject", value: "Project update" },
          { name: "To", value: "Me <me@example.com>" },
          { name: "Cc", value: "Bob <bob@example.com>" },
        ],
        mimeType: "multipart/alternative",
        parts: [
          {
            body: { data: encodeBody("Original text") },
            mimeType: "text/plain",
          },
          {
            body: { data: encodeBody("<p><strong>Original HTML</strong></p>") },
            mimeType: "text/html",
          },
        ],
      },
    },
  ],
} as GatewayThread;

const decodeRaw = (raw: string): string =>
  Buffer.from(raw, "base64url").toString("utf-8");

const decodeTransferBodies = (raw: string): readonly string[] => {
  const lines = raw.split("\r\n");

  return lines.flatMap((line, index) =>
    lines[index - 2] === "Content-Transfer-Encoding: base64" &&
    lines[index - 1] === ""
      ? [Buffer.from(line, "base64").toString("utf-8")]
      : []
  );
};

const parse = <Payload>(payload: Payload) =>
  Effect.runSync(
    GmailMime.pipe(
      Effect.flatMap((mime) =>
        mime.parseThread({
          historyId: HistoryId.make("1"),
          id: ThreadId.make("thread-1"),
          labelIds: ["INBOX"],
          messages: [
            {
              id: "message-1",
              internalDate: "1700000000000",
              labelIds: ["INBOX"],
              payload,
            },
          ],
        } as GatewayThread)
      ),
      Effect.provide(GmailMimeLive)
    )
  ).messages[0];

describe("GmailMime.parseThread", () => {
  it("loads the HTML body from a nested MIME message", () => {
    const message = parse({
      mimeType: "multipart/alternative",
      parts: [
        {
          body: { data: encodeBody("Hello, Kisa 👋") },
          mimeType: "text/plain",
        },
        {
          body: { data: encodeBody("<p>Hello, Kisa 👋</p>") },
          mimeType: "text/html",
        },
      ],
    });

    expect(message?.body).toStrictEqual({
      hasBlockedRemoteImages: false,
      sanitizedHtml: "<p>Hello, Kisa 👋</p>",
      type: "html",
    });
  });

  it("falls back to the text body when there is no HTML part", () => {
    const message = parse({
      parts: [
        {
          body: { data: encodeBody("Visible message") },
          mimeType: "text/plain",
        },
      ],
    });

    expect(message?.body).toStrictEqual({
      text: "Visible message",
      type: "text",
    });
  });

  it("does not treat text attachments as the message body", () => {
    const message = parse({
      parts: [
        {
          body: { data: encodeBody("Visible message") },
          mimeType: "text/plain",
        },
        {
          body: { attachmentId: "attachment-1", data: encodeBody("Ignored") },
          filename: "notes.txt",
          mimeType: "text/plain",
        },
      ],
    });

    expect(message?.body).toStrictEqual({
      text: "Visible message",
      type: "text",
    });
  });

  it("flags remote images so the renderer can offer to load them", () => {
    const message = parse({
      body: {
        data: encodeBody('<img src="https://tracker.example/pixel.gif">'),
      },
      mimeType: "text/html",
    });

    expect(
      message?.body.type === "html" && message.body.hasBlockedRemoteImages
    ).toBeTruthy();
  });

  it("does not flag inline attachment images as remote", () => {
    const message = parse({
      body: { data: encodeBody('<img src="cid:logo@example">') },
      mimeType: "text/html",
    });

    expect(
      message?.body.type === "html" && message.body.hasBlockedRemoteImages
    ).toBeFalsy();
  });

  it("collects attachments with their content id", () => {
    const message = parse({
      parts: [
        {
          body: { attachmentId: "attachment-1", size: 12 },
          filename: "logo.png",
          headers: [{ name: "Content-ID", value: "<logo@example>" }],
          mimeType: "image/png",
        },
      ],
    });

    expect(message?.attachments).toStrictEqual([
      expect.objectContaining({
        attachmentId: "attachment-1",
        contentId: "logo@example",
        filename: "logo.png",
        mediaType: "image/png",
        size: 12,
      }),
    ]);
  });
});

describe("GmailMime sending", () => {
  it("composes a threaded reply with the original message quoted", () => {
    const message = Effect.runSync(
      GmailMime.pipe(
        Effect.flatMap((mime) =>
          mime.composeReply(
            {
              accountId: AccountId.make("me@example.com"),
              attachments: [
                {
                  bytes: new TextEncoder().encode("Reply attachment"),
                  filename: "reply.txt",
                  mediaType: "text/plain",
                },
              ],
              body: {
                html: "<p>My reply</p>",
                text: "My reply",
                type: "html",
              },
              cc: [new Mailbox({ address: "bob@example.com" })],
              replyToMessageId: MessageId.make("message-1"),
              threadId: ThreadId.make("thread-1"),
              to: [new Mailbox({ address: "alice@example.com" })],
            },
            testThread
          )
        ),
        Effect.provide(GmailMimeLive)
      )
    );
    const raw = decodeRaw(message.raw);
    const bodies = decodeTransferBodies(raw);

    expect({
      hasAttachment: raw.includes(
        'Content-Disposition: attachment; filename="reply.txt"'
      ),
      hasCc: raw.includes("Cc: bob@example.com"),
      hasInReplyTo: raw.includes("In-Reply-To: <message-1@example.com>"),
      hasReferences: raw.includes(
        "References: <earlier@example.com> <message-1@example.com>"
      ),
      hasSubject: raw.includes("Subject: Re: Project update"),
      hasTo: raw.includes("To: alice@example.com"),
      threadId: message.threadId,
    }).toStrictEqual({
      hasAttachment: true,
      hasCc: true,
      hasInReplyTo: true,
      hasReferences: true,
      hasSubject: true,
      hasTo: true,
      threadId: "thread-1",
    });
    expect(bodies).toContainEqual(expect.stringContaining("My reply"));
    expect(raw).toContain(
      Buffer.from("Reply attachment", "utf-8").toString("base64")
    );
    expect(bodies).toContainEqual(expect.stringContaining("Original text"));
    expect(bodies).toContainEqual(expect.stringContaining("Original HTML"));
  });

  it("composes new messages with file attachments", () => {
    const message = Effect.runSync(
      GmailMime.pipe(
        Effect.flatMap((mime) =>
          mime.composeMessage({
            accountId: AccountId.make("me@example.com"),
            attachments: [
              {
                bytes: new TextEncoder().encode("Attachment contents"),
                filename: "notes.txt",
                mediaType: "text/plain",
              },
            ],
            body: { html: "<p>Hello</p>", text: "Hello", type: "html" },
            rfc822MessageId: "<scheduled-message@scheduled.kisa.invalid>",
            subject: "Attached notes",
            to: [new Mailbox({ address: "carol@example.com" })],
          })
        ),
        Effect.provide(GmailMimeLive)
      )
    );
    const raw = decodeRaw(message.raw);

    expect({
      hasAttachmentDisposition: raw.includes(
        'Content-Disposition: attachment; filename="notes.txt"'
      ),
      hasAttachmentType: raw.includes(
        'Content-Type: text/plain; name="notes.txt"'
      ),
      hasMessageId: raw.includes(
        "Message-ID: <scheduled-message@scheduled.kisa.invalid>"
      ),
      hasMixedBody: raw.includes("Content-Type: multipart/mixed"),
      hasSubject: raw.includes("Subject: Attached notes"),
    }).toStrictEqual({
      hasAttachmentDisposition: true,
      hasAttachmentType: true,
      hasMessageId: true,
      hasMixedBody: true,
      hasSubject: true,
    });
    expect(raw).toContain(
      Buffer.from("Attachment contents", "utf-8").toString("base64")
    );
  });

  it("keeps composer images at their CID body position", () => {
    const message = Effect.runSync(
      GmailMime.pipe(
        Effect.flatMap((mime) =>
          mime.composeMessage({
            accountId: AccountId.make("me@example.com"),
            attachments: [
              {
                bytes: new Uint8Array([1, 2, 3]),
                contentId: "photo@inline.kisa.email",
                filename: "photo.png",
                mediaType: "image/png",
              },
            ],
            body: {
              html: '<p>Before</p><img alt="photo.png" src="cid:photo@inline.kisa.email"><p>After</p>',
              text: "Before\n[Image: photo.png]\nAfter",
              type: "html",
            },
            subject: "Inline photo",
            to: [new Mailbox({ address: "carol@example.com" })],
          })
        ),
        Effect.provide(GmailMimeLive)
      )
    );
    const raw = decodeRaw(message.raw);
    const bodies = decodeTransferBodies(raw);

    expect(raw).toContain("Content-Type: multipart/related");
    expect(raw).toContain("Content-ID: <photo@inline.kisa.email>");
    expect(raw).toContain("Content-Disposition: inline;");
    expect(bodies).toContainEqual(
      expect.stringContaining('src="cid:photo@inline.kisa.email"')
    );
  });

  it("nests inline images with the body before regular attachments", () => {
    const message = Effect.runSync(
      GmailMime.pipe(
        Effect.flatMap((mime) =>
          mime.composeMessage({
            accountId: AccountId.make("me@example.com"),
            attachments: [
              {
                bytes: new Uint8Array([1, 2, 3]),
                contentId: "photo@inline.kisa.email",
                filename: "photo.png",
                mediaType: "image/png",
              },
              {
                bytes: new TextEncoder().encode("Notes"),
                filename: "notes.txt",
                mediaType: "text/plain",
              },
            ],
            body: {
              html: '<p>Before</p><img src="cid:photo@inline.kisa.email">',
              text: "Before\n[Image: photo.png]",
              type: "html",
            },
            subject: "Inline photo and notes",
            to: [new Mailbox({ address: "carol@example.com" })],
          })
        ),
        Effect.provide(GmailMimeLive)
      )
    );
    const raw = decodeRaw(message.raw);
    const relatedEnd = raw.indexOf("--", raw.indexOf("Content-ID:"));
    const regularAttachment = raw.indexOf(
      'Content-Disposition: attachment; filename="notes.txt"'
    );

    expect(raw).toContain("Content-Type: multipart/mixed");
    expect(raw).toContain("Content-Type: multipart/related");
    expect(raw).toContain("Content-ID: <photo@inline.kisa.email>");
    expect(relatedEnd).toBeGreaterThan(raw.indexOf("Content-ID:"));
    expect(regularAttachment).toBeGreaterThan(relatedEnd);
  });

  it("falls back to an attachment when the body does not reference its CID", () => {
    const message = Effect.runSync(
      GmailMime.pipe(
        Effect.flatMap((mime) =>
          mime.composeForward(
            {
              accountId: AccountId.make("me@example.com"),
              attachments: [
                {
                  bytes: new Uint8Array([1, 2, 3]),
                  contentId: "logo@example.com",
                  filename: "logo.png",
                  mediaType: "image/png",
                },
              ],
              body: { text: "FYI", type: "text" },
              forwardMessageId: MessageId.make("message-1"),
              threadId: ThreadId.make("thread-1"),
              to: [new Mailbox({ address: "carol@example.com" })],
            },
            testThread
          )
        ),
        Effect.provide(GmailMimeLive)
      )
    );
    const raw = decodeRaw(message.raw);
    const bodies = decodeTransferBodies(raw);

    expect({
      hasAttachmentDisposition: raw.includes(
        'Content-Disposition: attachment; filename="logo.png"'
      ),
      hasContentId: raw.includes("Content-ID: <logo@example.com>"),
      hasInlineDisposition: raw.includes("Content-Disposition: inline;"),
      hasRelatedBody: raw.includes("Content-Type: multipart/related"),
      hasSubject: raw.includes("Subject: Fwd: Project update"),
      hasTo: raw.includes("To: carol@example.com"),
      threadId: message.threadId,
    }).toStrictEqual({
      hasAttachmentDisposition: true,
      hasContentId: false,
      hasInlineDisposition: false,
      hasRelatedBody: false,
      hasSubject: true,
      hasTo: true,
      threadId: undefined,
    });
    expect(bodies).toContainEqual(expect.stringContaining("FYI"));
    expect(bodies).toContainEqual(
      expect.stringContaining("---------- Forwarded message ---------")
    );
    expect(bodies).toContainEqual(expect.stringContaining("Original HTML"));
  });
});
