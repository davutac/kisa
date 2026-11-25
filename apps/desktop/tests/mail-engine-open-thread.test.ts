// Opening a conversation through the engine, against the real SQLite store
// and a fake IMAP server; only Electron-facing modules are replaced.
// oxlint-disable vitest/prefer-import-in-mock
import { gmailDialect } from "@repo/mail/dialects";
import { MessageId } from "@repo/mail/ids";
import { ImapConnector } from "@repo/mail/session";
import { SmtpTransport } from "@repo/mail/smtp";
import { MailEngineStore } from "@repo/mail/store";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DAY_MS,
  clearUnusedInlineImages,
  isInlineImageClearingDue,
  readCachedInlineImages,
  saveInlineImages,
} from "../src/main/mail/engine/inline-image-cache";
import { loadThread } from "../src/main/mail/engine/mail-engine";
import { closeAllSessions } from "../src/main/mail/engine/mail-sessions";
import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  TestDatabase,
  TestStore,
  accountId,
  connection,
  gmailMessage,
  insertAccount,
  remoteDatabase,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";
import { found } from "./fixtures/rows";

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
        kind: "password",
        password: Redacted.make("app-password"),
        user: "test@example.com",
      }),
  };
});

const LOGO = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");

const layersWith = (connector: ImapConnector["Service"]) =>
  Layer.mergeAll(
    TestStore,
    TestDatabase,
    Layer.succeed(ImapConnector, ImapConnector.of(connector)),
    Layer.succeed(
      SmtpTransport,
      SmtpTransport.of({ send: () => Effect.die("no sending here") })
    )
  );

const layers = (server: FakeImapServer) =>
  layersWith({ connect: () => Effect.succeed(server.session()) });

const keptImageUsedAt = (): number | undefined =>
  connection
    .prepare<unknown[], { usedAt: number }>(
      "SELECT used_at AS usedAt FROM mail_inline_images"
    )
    .get()?.usedAt;

const keptImageCount = (): number =>
  found(
    connection
      .prepare<unknown[], { count: number }>(
        "SELECT count(*) AS count FROM mail_inline_images"
      )
      .get()
  ).count;

/** Opens the conversation in full once, which keeps its inline image. */
const openLogoMessageOnce = async (): Promise<void> => {
  const server = await serveUnreadLogoMessage();
  await Effect.runPromise(
    loadThread({ accountId, threadId: "950" }).pipe(
      Effect.provide(layers(server))
    )
  );
  await Effect.runPromise(closeAllSessions);
};

/** An unread message whose body shows one image part by `cid:`. */
const serveUnreadLogoMessage = async (): Promise<FakeImapServer> => {
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

  return server;
};

describe("opening a conversation", () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    await Effect.runPromise(closeAllSessions);
  });

  it("leaves inline images and the read state owed when read from the cache", async () => {
    const server = await serveUnreadLogoMessage();
    const callsBefore = server.calls.length;

    const cached = await Effect.runPromise(
      loadThread({ accountId, cachedOnly: true, threadId: "950" }).pipe(
        Effect.provide(layers(server))
      )
    );

    // Only the missing body comes from the server.
    expect(cached.awaitsServer).toBeTruthy();
    expect(cached.messages[0]?.body.html).toContain('src="cid:logo@example"');
    expect(threadRow("950")).toMatchObject({ is_unread: 1 });
    expect(
      server.calls
        .slice(callsBefore)
        .filter((call) => !call.startsWith("fetch"))
    ).toStrictEqual([]);
  });

  it("downloads its body, shows cid images inline and marks it read", async () => {
    const server = await serveUnreadLogoMessage();

    const thread = await Effect.runPromise(
      loadThread({ accountId, threadId: "950" }).pipe(
        Effect.provide(layers(server))
      )
    );

    const [message] = thread.messages;

    expect(thread.awaitsServer).toBeFalsy();
    expect(message?.body.html).toContain(`src="data:image/png;base64,${LOGO}"`);
    expect(message?.attachments).toStrictEqual([]);
    expect(threadRow("950")).toMatchObject({ is_unread: 0 });
    expect(server.calls).toContain(`store ${ALL_MAIL} add \\Seen`);
  });

  it("owes nothing for a read conversation without inline images", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("960", "960"));
    await syncFully(scopeFor(server, gmailDialect));

    const cached = await Effect.runPromise(
      loadThread({ accountId, cachedOnly: true, threadId: "960" }).pipe(
        Effect.provide(layers(server))
      )
    );

    expect(cached.awaitsServer).toBeFalsy();
    expect(cached.messages).toHaveLength(1);
  });
});

/** Opens the conversation from the cache with the server unreachable. */
const openFromCacheOffline = () =>
  Effect.runPromise(
    loadThread({ accountId, cachedOnly: true, threadId: "950" }).pipe(
      Effect.provide(
        layersWith({ connect: () => Effect.die("no server needed") })
      )
    )
  );

describe("kept inline images", () => {
  beforeEach(resetDatabase);

  afterEach(async () => {
    await Effect.runPromise(closeAllSessions);
  });

  it("shows an opened conversation's images again without the server", async () => {
    await openLogoMessageOnce();
    let connections = 0;

    const thread = await Effect.runPromise(
      loadThread({ accountId, cachedOnly: true, threadId: "950" }).pipe(
        Effect.provide(
          layersWith({
            connect: () => {
              connections += 1;

              return Effect.die("the server is unreachable");
            },
          })
        )
      )
    );

    expect(thread.awaitsServer).toBeFalsy();
    expect(thread.messages[0]?.body.html).toContain(
      `src="data:image/png;base64,${LOGO}"`
    );
    expect(connections).toBe(0);
  });

  it("keeps each account's images to itself", async () => {
    await openLogoMessageOnce();

    const own = await readCachedInlineImages(remoteDatabase, accountId, [
      "950",
    ]);

    const other = await readCachedInlineImages(
      remoteDatabase,
      "other@example.com",
      ["950"]
    );

    expect([...own.values()].map(({ mediaType }) => mediaType)).toStrictEqual([
      "image/png",
    ]);
    expect(other.size).toBe(0);
  });

  it("keeps no image for a message that has left the cache", async () => {
    insertAccount("gmail");

    await saveInlineImages(
      remoteDatabase,
      accountId,
      [
        {
          bytes: Buffer.from(LOGO, "base64"),
          mediaType: "image/png",
          messageId: "gone",
          section: "2",
        },
      ],
      Date.now()
    );

    expect(keptImageCount()).toBe(0);
  });

  it("lets a message's images go with it", async () => {
    await openLogoMessageOnce();
    connection
      .prepare("DELETE FROM mail_message_locations WHERE message_id = ?")
      .run("950");

    await run(
      MailEngineStore.use((store) =>
        store.removeMessagesWithoutCopies(accountId, [MessageId.make("950")])
      )
    );

    expect(keptImageCount()).toBe(0);
  });

  it("forgets a disconnected account's images", async () => {
    await openLogoMessageOnce();

    await run(MailEngineStore.use((store) => store.clearAccount(accountId)));

    expect(keptImageCount()).toBe(0);
  });

  it("records when kept images are shown again, at most once a day", async () => {
    await openLogoMessageOnce();
    const openedAt = keptImageUsedAt() ?? 0;
    // Shown again the same day: nothing is written.
    await openFromCacheOffline();
    expect(keptImageUsedAt()).toBe(openedAt);

    connection.prepare("UPDATE mail_inline_images SET used_at = 1").run();
    await openFromCacheOffline();
    expect(keptImageUsedAt()).toBeGreaterThanOrEqual(openedAt);
  });

  it("clears only the account's images not shown since the cutoff", async () => {
    await openLogoMessageOnce();

    const insertKept = connection.prepare(
      `INSERT INTO mail_inline_images
         (account_id, message_id, section, media_type, data, used_at)
       VALUES (?, ?, '2', 'image/png', x'00', ?)`
    );

    insertKept.run(accountId, "old", 1000);
    insertKept.run("other@example.com", "old", 1000);

    await clearUnusedInlineImages(remoteDatabase, accountId, 2000);

    expect(
      connection
        .prepare(
          "SELECT account_id AS accountId, message_id AS messageId FROM mail_inline_images ORDER BY account_id"
        )
        .all()
    ).toStrictEqual([
      { accountId: "other@example.com", messageId: "old" },
      { accountId, messageId: "950" },
    ]);
  });
});

describe(isInlineImageClearingDue, () => {
  const now = 10 * DAY_MS;

  it("clears once a day while images are kept for a while", () => {
    expect(isInlineImageClearingDue(undefined, 90, now)).toBeTruthy();
    expect(
      isInlineImageClearingDue(
        { at: now - DAY_MS / 2, retentionDays: 90 },
        90,
        now
      )
    ).toBeFalsy();
    expect(
      isInlineImageClearingDue({ at: now - DAY_MS, retentionDays: 90 }, 90, now)
    ).toBeTruthy();
  });

  it("clears at once when the period changes, and never for forever", () => {
    expect(
      isInlineImageClearingDue({ at: now, retentionDays: 90 }, 30, now)
    ).toBeTruthy();
    expect(isInlineImageClearingDue(undefined, null, now)).toBeFalsy();
  });
});
