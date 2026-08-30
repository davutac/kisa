// oxlint-disable typescript/no-unsafe-type-assertion
import { gzipSync } from "node:zlib";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import type { gmailMessages } from "@repo/database/schemas";
import type { GatewayAttachmentRequest } from "@repo/gmail/gateway";
import type { GmailAuthorization } from "@repo/gmail/models";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { withDatabaseClient } from "../src/main/database";
import type { sendRendererEvent } from "../src/main/electron/renderer-events";
import { loadFullThread } from "../src/main/mail/mail-sync";
import type {
  dismissThreadNotifications,
  showNewMailNotifications,
} from "../src/main/mail/new-mail-notifications";

type CachedMessageRow = typeof gmailMessages.$inferSelect;

const state = vi.hoisted(() => ({
  attachmentFails: false,
  attachmentRequests: [] as GatewayAttachmentRequest[],
  inlineImageBase64: "AQID",
  messageSchemaVersion: 1 as const,
  messages: [] as CachedMessageRow[],
}));

const regularAttachment = {
  attachmentId: "attachment-2",
  filename: "notes.pdf",
  mediaType: "application/pdf",
  messageId: "message-1",
  size: 42,
};

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: vi.fn<typeof sendRendererEvent>(),
}));

vi.mock(import("../src/main/mail/new-mail-notifications"), () => ({
  dismissThreadNotifications: vi.fn<typeof dismissThreadNotifications>(),
  showNewMailNotifications: vi.fn<typeof showNewMailNotifications>(),
}));

vi.mock(import("../src/main/database"), async () => {
  const { Effect: EffectModule } = await import("effect");
  const useTestDatabase = (<A>(
    run: (database: RemoteDatabaseClient) => Promise<A>
  ) =>
    EffectModule.promise(() =>
      run({
        query: {
          gmailMessages: {
            findMany: () => Promise.resolve(state.messages),
          },
          gmailThreads: {
            findFirst: () =>
              Promise.resolve({
                isUnread: false,
                labels: ["SENT"],
                messageCount: 1,
              }),
          },
        },
      } as never)
    )) as typeof withDatabaseClient;

  return { withDatabaseClient: useTestDatabase };
});

vi.mock(import("../src/main/mail/gmail-store"), async () => {
  const { GmailStore } = await import("@repo/gmail/store");
  const { Effect: EffectModule, Layer, Option } = await import("effect");

  return {
    GmailStoreLive: Layer.succeed(GmailStore, {
      getAuthorization: () =>
        EffectModule.succeed(
          Option.some({
            account: {
              capabilities: { modify: true, read: true, send: true },
              email: "me@example.com",
              id: "me@example.com",
              scopes: ["https://mail.google.com/"],
            },
            credentials: {},
          })
        ),
    } as never),
    MESSAGE_SCHEMA_VERSION: state.messageSchemaVersion,
  };
});

vi.mock(import("../src/main/mail/gmail-gateway"), async () => {
  const { GmailApiError } = await import("@repo/gmail/errors");
  const { GmailGateway } = await import("@repo/gmail/gateway");
  const { Effect: EffectModule, Layer } = await import("effect");

  return {
    GmailGatewayLive: Layer.succeed(GmailGateway, {
      getAttachment: (
        _authorization: GmailAuthorization,
        request: GatewayAttachmentRequest
      ) => {
        state.attachmentRequests.push(request);

        if (state.attachmentFails) {
          return EffectModule.fail(
            new GmailApiError({
              message: "Offline",
              retryable: true,
            })
          );
        }

        return EffectModule.succeed({
          value: {
            bytes: Buffer.from(state.inlineImageBase64, "base64"),
            filename: "photo.png",
            mediaType: "image/png",
          },
        });
      },
    } as never),
  };
});

vi.mock(import("../src/main/mail/gmail-mime"), async () => {
  const { GmailMime } = await import("@repo/gmail/mime");
  const { Layer } = await import("effect");

  return { GmailMimeLive: Layer.succeed(GmailMime, {} as never) };
});

const loadCachedThread = () =>
  Effect.runPromise(
    loadFullThread({
      accountId: "me@example.com",
      threadId: "thread-1",
    })
  );

describe("cached inline images", () => {
  beforeEach(() => {
    state.attachmentFails = false;
    state.attachmentRequests.length = 0;
    state.messages = [
      {
        accountEmail: "me@example.com",
        attachments: [
          {
            attachmentId: "attachment-1",
            contentId: "photo@inline.kisa.email",
            filename: "photo.png",
            mediaType: "image/png",
            messageId: "message-1",
            size: Buffer.from(state.inlineImageBase64, "base64").byteLength,
          },
          regularAttachment,
        ],
        bccAddresses: [],
        bodyHtml: gzipSync(
          Buffer.from(
            '<p>Before</p><img alt="photo.png" src="cid:photo@inline.kisa.email"><p>After</p>',
            "utf-8"
          )
        ),
        bodyText: "Before\n[Image: photo.png]\nAfter",
        ccAddresses: [],
        fromAddress: "me@example.com",
        fromName: "Me",
        hasBlockedRemoteImages: false,
        internalDate: Date.now(),
        labelIds: ["SENT"],
        messageId: "message-1",
        replyToAddress: null,
        schemaVersion: state.messageSchemaVersion,
        subject: "Inline photo",
        threadId: "thread-1",
        toAddresses: ["friend@example.com"],
        updatedAt: Date.now(),
      },
    ];
  });

  it("hydrates a fresh cached CID image without a duplicate attachment", async () => {
    const thread = await loadCachedThread();

    const body = thread.messages[0]?.body;

    expect(body).toStrictEqual({
      html: `<p>Before</p><img alt="photo.png" src="data:image/png;base64,${state.inlineImageBase64}"><p>After</p>`,
    });
    expect(thread.messages[0]?.attachments).toStrictEqual([regularAttachment]);
    expect(state.attachmentRequests).toStrictEqual([
      {
        accountId: "me@example.com",
        attachmentId: "attachment-1",
        filename: "photo.png",
        mediaType: "image/png",
        messageId: "message-1",
        threadId: "thread-1",
      },
    ]);
  });

  it("keeps the image as an attachment when its inline bytes are unavailable", async () => {
    state.attachmentFails = true;

    const thread = await loadCachedThread();

    expect(thread.messages[0]?.body).toStrictEqual({
      html: '<p>Before</p><img alt="photo.png" src="cid:photo@inline.kisa.email"><p>After</p>',
    });
    expect(thread.messages[0]?.attachments).toStrictEqual([
      expect.objectContaining({
        attachmentId: "attachment-1",
        filename: "photo.png",
      }),
      regularAttachment,
    ]);
    expect(state.attachmentRequests).toHaveLength(1);
  });
});
