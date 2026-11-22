// The engine runs against the real SQLite store, a fake IMAP server and a
// fake SMTP transport; only Electron-facing modules are replaced.
// oxlint-disable typescript/no-unsafe-type-assertion vitest/prefer-import-in-mock
import { gmailDialect, genericDialect } from "@repo/mail/dialects";
import { MailSendUnknownError } from "@repo/mail/errors";
import { ImapConnector } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import type { SmtpSendRequest } from "@repo/mail/smtp";
import { Effect, Exit, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findSentMessage,
  sendNewMessage,
  sendThreadMessage,
} from "../src/main/mail/engine/mail-send";
import { closeAllSessions } from "../src/main/mail/engine/mail-sessions";
import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  TestDatabase,
  TestStore,
  accountId,
  connection,
  genericMessage,
  insertAccount,
  resetDatabase,
  scopeFor,
  syncFully,
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
vi.mock("../src/main/mail/engine/account-credentials", async () => {
  const { Effect: MockEffect, Redacted } = await import("effect");
  return {
    resolveImapAuth: () =>
      MockEffect.succeed({
        kind: "password",
        password: Redacted.make("app-password"),
        user: "test@example.com",
      }),
  };
});

const sent: SmtpSendRequest[] = [];
let smtpResult: Effect.Effect<{ refused: string[] }, MailSendUnknownError> =
  Effect.succeed({ refused: [] });

const layers = (server: FakeImapServer) =>
  Layer.mergeAll(
    TestStore,
    TestDatabase,
    Layer.succeed(
      ImapConnector,
      ImapConnector.of({ connect: () => Effect.succeed(server.session()) })
    ),
    Layer.succeed(
      SmtpTransport,
      SmtpTransport.of({
        send: (request) =>
          Effect.suspend(() => {
            sent.push(request);
            return smtpResult;
          }),
      })
    )
  );

const transmitted = (index = 0) =>
  Buffer.from(sent[index]?.message ?? new Uint8Array()).toString("utf-8");

const body = { html: "<p>Hi</p>", text: "Hi" };

const newMessage = {
  accountId,
  attachments: [],
  bcc: ["hidden@example.com"],
  body,
  cc: [],
  subject: "Plans",
  to: ["Friend <friend@example.com>"],
};

/** An iCloud account; `prepare` adds mail before the first sync. */
const syncedIcloud = async (prepare?: (server: FakeImapServer) => void) => {
  insertAccount("generic");
  const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
  prepare?.(server);
  await syncFully(scopeFor(server, genericDialect));
  return server;
};

describe("sending", () => {
  beforeEach(() => {
    resetDatabase();
    sent.length = 0;
    smtpResult = Effect.succeed({ refused: [] });
  });

  afterEach(async () => {
    await Effect.runPromise(closeAllSessions);
  });

  it("files one Sent copy with Bcc on iCloud, and none on Gmail", async () => {
    const server = await syncedIcloud();

    const run = () =>
      Effect.runPromise(
        sendNewMessage(newMessage).pipe(Effect.provide(layers(server)))
      );
    await run();

    expect(sent[0]?.envelope.to).toStrictEqual([
      "friend@example.com",
      "hidden@example.com",
    ]);
    expect(transmitted()).not.toMatch(/^bcc:/imu);
    expect(server.appended).toHaveLength(1);
    expect(server.appended[0]).toMatchObject({
      flags: ["\\Seen"],
      path: "Sent Messages",
    });
    expect(server.appended[0]?.raw).toMatch(/^Bcc: hidden@example\.com$/mu);
  });

  it("leaves Sent to Gmail, which files what its server sends", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    await syncFully(scopeFor(server, gmailDialect));

    await Effect.runPromise(
      sendNewMessage(newMessage).pipe(Effect.provide(layers(server)))
    );

    expect(sent).toHaveLength(1);
    expect(server.appended).toStrictEqual([]);
  });

  it("files nothing when the outcome of the send is unknown", async () => {
    const server = await syncedIcloud();
    smtpResult = Effect.fail(
      new MailSendUnknownError({ accountId, message: "dropped" })
    );

    const exit = await Effect.runPromiseExit(
      sendNewMessage(newMessage).pipe(Effect.provide(layers(server)))
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(server.appended).toStrictEqual([]);
  });

  it("threads a reply under the cached message it answers", async () => {
    const server = await syncedIcloud((fresh) => {
      fresh.deliver(
        "INBOX",
        genericMessage("parent", {
          envelope: envelope({
            inReplyTo: "<earlier@example.com>",
            messageId: "<parent@example.com>",
            subject: "Plans",
          }),
          headers: { references: "<root@example.com> <earlier@example.com>" },
        })
      );
    });
    const parent = connection
      .prepare("SELECT message_id, thread_id FROM mail_messages")
      .get() as { message_id: string; thread_id: string };

    await Effect.runPromise(
      sendThreadMessage({
        ...newMessage,
        action: "reply",
        bcc: [],
        messageId: parent.message_id,
        threadId: parent.thread_id,
      }).pipe(Effect.provide(layers(server)))
    );

    expect(transmitted()).toContain("In-Reply-To: <parent@example.com>");
    expect(transmitted()).toContain(
      "References: <root@example.com>\r\n <earlier@example.com>\r\n <parent@example.com>"
    );
    expect(transmitted()).toContain("Subject: Re: Plans");
  });

  it("finds a scheduled message in sent mail by its Message-ID", async () => {
    const server = await syncedIcloud((fresh) => {
      fresh.deliver(
        "Sent Messages",
        genericMessage("s", {
          envelope: envelope({ messageId: "<abc@scheduled.kisa.invalid>" }),
        })
      );
    });

    const find = (id: string) =>
      Effect.runPromise(
        findSentMessage(accountId, id).pipe(Effect.provide(layers(server)))
      );

    await expect(find("<abc@scheduled.kisa.invalid>")).resolves.toBeTruthy();
    await expect(find("<other@scheduled.kisa.invalid>")).resolves.toBeFalsy();
    expect(
      connection.prepare("SELECT count(*) AS count FROM mail_messages").get()
    ).toStrictEqual({ count: 1 });
  });
});
