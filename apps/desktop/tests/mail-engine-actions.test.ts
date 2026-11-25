// Thread actions through the engine, against the real SQLite store and a
// fake IMAP server; only Electron-facing modules are replaced.
// oxlint-disable vitest/prefer-import-in-mock
import { gmailDialect } from "@repo/mail/dialects";
import { ImapConnector } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import { Effect, Exit, Layer, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendRendererEvent } from "../src/main/electron/renderer-events";
import { announceArrivals } from "../src/main/mail/engine/mail-arrivals";
import { applyThreadActions } from "../src/main/mail/engine/mail-engine";
import { closeAllSessions } from "../src/main/mail/engine/mail-sessions";
import { MAIL_THREAD_LIST_UPDATED_CHANNEL } from "../src/shared/ipc/channels";
import { MailThreadListUpdated } from "../src/shared/ipc/mail";
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
        kind: "password",
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

/** The conversations the thread list events sent to the windows upsert. */
const listedUpserts = () => {
  const isListUpdate = Schema.is(MailThreadListUpdated);
  return vi
    .mocked(sendRendererEvent)
    .mock.calls.flatMap(([channel, , payload]) =>
      channel === MAIL_THREAD_LIST_UPDATED_CHANNEL && isListUpdate(payload)
        ? payload.changes
        : []
    )
    .flatMap((change) => (change.kind === "upsert" ? [change.thread] : []));
};

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

  // The renderer drops its optimistic copy of an acted-on conversation when
  // the action answers; if the event left it out, the row would snap back.
  it("keeps the conversation it acted on in a crowded thread list event", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("1000", "1000"));
    await syncFully(scopeFor(server, gmailDialect));
    // More new conversations than one event carries, all newer than it.
    for (let id = 1001; id <= 1200; id += 1) {
      server.deliver(ALL_MAIL, gmailMessage(String(id), String(id)));
    }
    vi.mocked(sendRendererEvent).mockClear();

    await Effect.runPromise(
      applyThreadActions(accountId, ["1000"], { kind: "trash" }).pipe(
        Effect.provide(layers(server))
      )
    );

    const upserts = listedUpserts();

    expect(upserts).toHaveLength(200);
    expect(
      upserts.find((thread) => thread.threadId === "1000")?.labels
    ).toContain("TRASH");
  });

  // The refresh saved the new mail before it failed, and the pass that
  // follows finds it cached and reports nothing: only the failing action can
  // show and announce it.
  it("shows and announces mail it had saved when it failed", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("1000", "1000"));
    await syncFully(scopeFor(server, gmailDialect));
    server.deliver(ALL_MAIL, gmailMessage("1001", "1001", { flags: [] }));
    // The refresh fetches the new mail by UID and saves it. The fetch of
    // changed flags that follows, over a range, loses the connection.
    server.dropFetch = (_path, selection) => selection.kind === "range";
    vi.mocked(sendRendererEvent).mockClear();

    const exit = await Effect.runPromiseExit(
      applyThreadActions(accountId, ["1000"], { kind: "trash" }).pipe(
        Effect.provide(layers(server))
      )
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(listedUpserts().map((thread) => thread.threadId)).toContain("1001");
    expect(announceArrivals).toHaveBeenCalledWith(
      accountId,
      ["1001"],
      expect.anything()
    );
  });
});
