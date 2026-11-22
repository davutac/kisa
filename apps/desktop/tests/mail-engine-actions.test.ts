// Thread actions through the engine, against the real SQLite store and a
// fake IMAP server; only Electron-facing modules are replaced.
// oxlint-disable vitest/prefer-import-in-mock
import { gmailDialect } from "@repo/mail/dialects";
import { ImapConnector } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { announceArrivals } from "../src/main/mail/engine/mail-arrivals";
import { applyThreadActions } from "../src/main/mail/engine/mail-engine";
import { closeAllSessions } from "../src/main/mail/engine/mail-sessions";
import { FakeImapServer } from "./fixtures/fake-imap-server";
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
} from "./fixtures/mail-engine-harness";

vi.mock("../src/main/database", () => ({
  withDatabaseClient: vi.fn<() => never>(),
}));
vi.mock("../src/main/mail/new-mail-notifications", () => ({
  dismissInactiveThreadNotifications: vi.fn<() => void>(),
}));
vi.mock("../src/main/mail/engine/mail-arrivals", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    announceArrivals: vi.fn<typeof announceArrivals>(() => MockEffect.void),
  };
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
        password: Redacted.make("app-password"),
        user: "test@example.com",
      }),
  };
});

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
      SmtpTransport.of({ send: () => Effect.die("no sending here") })
    )
  );

describe("thread actions in the engine", () => {
  beforeEach(() => {
    resetDatabase();
    vi.mocked(announceArrivals).mockClear();
  });

  afterEach(async () => {
    await Effect.runPromise(closeAllSessions);
  });

  it("announces new mail that the action's refresh found first", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("1000", "1000"));
    await syncFully(scopeFor(server, gmailDialect));
    server.deliver(ALL_MAIL, gmailMessage("1001", "1001", { flags: [] }));

    await Effect.runPromise(
      applyThreadActions(accountId, ["1000"], { kind: "trash" }).pipe(
        Effect.provide(layers(server))
      )
    );

    expect(announceArrivals).toHaveBeenCalledWith(
      accountId,
      ["1001"],
      expect.anything()
    );
  });
});
