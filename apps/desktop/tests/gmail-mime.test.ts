import { describe, expect, it } from "@effect/vitest";
import type { GatewayThread } from "@repo/gmail/gateway";
import { GmailMime } from "@repo/gmail/mime";
import { HistoryId, ThreadId } from "@repo/gmail/models";
import { Effect } from "effect";

import { GmailMimeLive } from "../src/main/mail/gmail-mime";

const encodeBody = (value: string): string =>
  Buffer.from(value, "utf-8").toString("base64url");

const parse = (payload: unknown) =>
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
