// Opening a conversation through the engine, against the real SQLite store
// and a fake IMAP server; only Electron-facing modules are replaced.
// oxlint-disable vitest/prefer-import-in-mock
import { gmailDialect } from "@repo/mail/dialects";
import { ImapConnector } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadThread } from "../src/main/mail/engine/mail-engine";
import { closeAllSessions } from "../src/main/mail/engine/mail-sessions";
import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  TestDatabase,
  TestStore,
  accountId,
  gmailMessage,
  insertAccount,
  resetDatabase,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";

vi.mock("../src/main/database", () => ({
  withDatabaseClient: vi.fn<() => never>(),
}));
vi.mock("../src/main/mail/new-mail-notifications", () => ({
  dismissInactiveThreadNotifications: vi.fn<() => void>(),
}));
vi.mock("../src/main/mail/engine/mail-arrivals", async () => {
  const { Effect: MockEffect } = await import("effect");
  return { announceArrivals: () => MockEffect.void };
});
vi.mock("../src/main/electron/renderer-events", () => ({
  sendRendererEvent: vi.fn<() => void>(),
}));
vi.mock("../src/main/mail/unread-badge", async () => {
  const { Effect: MockEffect } = await import("effect");
  return { refreshUnreadBadge: () => MockEffect.void };
});
vi.mock("../src/main/mail/sender-brand", async () => {
  const { Effect: MockEffect } = await import("effect");
  return { getSenderBrand: () => MockEffect.succeed(null) };
});
vi.mock("../src/main/mail/trusted-image-senders", async () => {
  const { Effect: MockEffect } = await import("effect");
  return { loadTrustedImageSenderCheck: () => MockEffect.succeed(() => false) };
});
vi.mock("../src/main/mail/engine/account-credentials", async () => {
  const { Effect: MockEffect, Redacted } = await import("effect");
  return {
    resolveImapAuth: () =>
      MockEffect.succeed({
        password: Redacted.make("app-password"),
        user: "test@example.com",
      }),
  };
});

const LOGO = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

describe("opening a conversation", () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    await Effect.runPromise(closeAllSessions);
  });

  it("downloads its body, shows cid images inline and marks it read", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(
      ALL_MAIL,
      gmailMessage("950", "950", {
        envelope: envelope({
          messageId: "<logo@example.com>",
          subject: "Logo",
        }),
        flags: [],
        sections: {
          "1": '<p>Hi</p><img src="cid:logo@example">',
          "2": LOGO,
        },
        structure: {
          childNodes: [
            { part: "1", size: 40, type: "text/html" },
            {
              disposition: "inline",
              encoding: "base64",
              id: "<logo@example>",
              part: "2",
              size: 8,
              type: "image/png",
            },
          ],
          type: "multipart/related",
        },
      })
    );
    await syncFully(scopeFor(server, gmailDialect));

    const thread = await Effect.runPromise(
      loadThread({ accountId, threadId: "950" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestStore,
            TestDatabase,
            Layer.succeed(
              ImapConnector,
              ImapConnector.of({
                connect: () => Effect.succeed(server.session()),
              })
            ),
            Layer.succeed(
              SmtpTransport,
              SmtpTransport.of({ send: () => Effect.die("no sending here") })
            )
          )
        )
      )
    );
    const [message] = thread.messages;

    expect(message?.body.html).toContain(`src="data:image/png;base64,${LOGO}"`);
    expect(message?.attachments).toStrictEqual([]);
    expect(threadRow("950")).toMatchObject({ is_unread: 0 });
    expect(server.calls).toContain(`store ${ALL_MAIL} add \\Seen`);
  });
});
