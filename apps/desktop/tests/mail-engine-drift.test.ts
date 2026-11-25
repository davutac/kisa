// oxlint-disable typescript/no-unsafe-type-assertion
// The check a background pass makes that the cache still matches the
// server: its copies of a mailbox against the server's message count, and
// its unread copies against the server's unread count.
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { makeDriftMemory, relabelStep, syncAccount } from "@repo/mail/sync";
import type { DriftMemory, SyncScope } from "@repo/mail/sync";
import { watchForNews } from "@repo/mail/watch";
import { Deferred, Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  accountId,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
} from "./fixtures/mail-engine-harness";
import { found } from "./fixtures/rows";

const pass = (scope: SyncScope, drift: DriftMemory) =>
  run(syncAccount({ ...scope, drift }));

/** Runs the reread a pass started until it has read every copy. */
const rereadToEnd = async (scope: SyncScope): Promise<void> => {
  for (let step = 0; step < 50; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- One slice after another.
    if ((await run(relabelStep(scope))) === undefined) {
      return;
    }
  }

  throw new Error("the reread did not finish");
};

const inboxUids = (): readonly number[] =>
  connection
    .prepare<unknown[], { readonly uid: number }>(
      "SELECT uid FROM mail_message_locations WHERE account_id = ? AND mailbox_path = 'INBOX' ORDER BY uid"
    )
    .all(accountId)
    .map((row) => row.uid);

const unreadThreads = (): number =>
  found(
    connection
      .prepare<unknown[], { readonly n: number }>(
        "SELECT COUNT(*) AS n FROM mail_threads WHERE account_id = ? AND is_unread = 1"
      )
      .get(accountId)
  ).n;

/** Whether a reread of the Inbox's flags is under way. */
const isRereading = (): boolean =>
  found(
    connection
      .prepare<unknown[], { readonly cursor: number | null }>(
        "SELECT label_cursor AS cursor FROM mail_mailboxes WHERE account_id = ? AND path = 'INBOX'"
      )
      .get(accountId)
  ).cursor !== null;

/** A copy the cache holds and the server does not, at an unused UID. */
const addGhostCopy = (): void => {
  connection
    .prepare(
      `INSERT INTO mail_message_locations (account_id, flags, label_ids,
         mailbox_path, message_id, uid, uid_validity, updated_at)
       SELECT account_id, flags, label_ids, mailbox_path, message_id, 2,
         uid_validity, 0
       FROM mail_message_locations
       WHERE account_id = ? AND mailbox_path = 'INBOX' AND uid = 1`
    )
    .run(accountId);
};

/**
 * An Inbox of two read messages at UIDs 1 and 3, synced, with a memory for
 * the passes that follow.
 */
const syncedInbox = async (
  capabilities: readonly string[] = ["CONDSTORE", "IDLE"],
  mailboxes = ICLOUD_MAILBOXES
) => {
  insertAccount("generic");
  const server = new FakeImapServer(mailboxes, capabilities);
  server.deliver("INBOX", genericMessage("first"));
  server.skipUids("INBOX", 1);
  server.deliver("INBOX", genericMessage("second"));
  const scope = scopeFor(server, genericDialect);
  await syncFully(scope);

  return { drift: makeDriftMemory(), scope, server };
};

describe("a pass checking the cache against the server", () => {
  beforeEach(resetDatabase);

  it("asks the server nothing more while the counts agree", async () => {
    const { drift, scope, server } = await syncedInbox();

    const before = {
      calls: server.calls.length,
      statuses: server.statuses.length,
    };

    await pass(scope, drift);

    expect(server.calls.slice(before.calls)).toStrictEqual([]);
    expect(server.statuses.slice(before.statuses)).toHaveLength(
      ICLOUD_MAILBOXES.length
    );
  });

  // Without this, a count on the cache's side that was always zero would
  // pass every other test here.
  it("finds nothing to repair in a mailbox with unread mail it has cached", async () => {
    const { drift, scope, server } = await syncedInbox();
    server.deliver("INBOX", genericMessage("unread", { flags: [] }));
    await pass(scope, drift);
    const searches = server.calls.length;

    await pass(scope, drift);

    expect(unreadThreads()).toBe(1);
    expect(isRereading()).toBeFalsy();
    expect([...drift.unreconciled]).toStrictEqual([]);
    expect(server.calls.slice(searches)).toStrictEqual([]);
  });

  it("drops a copy the server does not have", async () => {
    const { drift, scope } = await syncedInbox();
    addGhostCopy();

    await pass(scope, drift);

    expect(inboxUids()).toStrictEqual([1, 3]);
  });

  // Old mail the cache lost, not mail that just arrived.
  it("fetches a copy the cache lost, without announcing it as new", async () => {
    const { drift, scope } = await syncedInbox();
    connection
      .prepare(
        "DELETE FROM mail_message_locations WHERE account_id = ? AND mailbox_path = 'INBOX' AND uid = 3"
      )
      .run(accountId);

    const changes = await pass(scope, drift);

    expect(inboxUids()).toStrictEqual([1, 3]);
    expect(changes.arrived ?? []).toStrictEqual([]);
  });

  it("reads the flags again, a slice a step, when the unread count differs", async () => {
    const { drift, scope, server } = await syncedInbox();
    server.setFlagsUnreported("INBOX", 1, []);

    await pass(scope, drift);
    // The pass only starts the reread: a whole mailbox's flags are not read
    // while it holds the cache's turn.
    expect(unreadThreads()).toBe(0);
    expect(isRereading()).toBeTruthy();

    await rereadToEnd(scope);
    expect(unreadThreads()).toBe(1);

    await pass(scope, drift);
    expect(isRereading()).toBeFalsy();
  });
});

describe("what the check leaves alone", () => {
  beforeEach(resetDatabase);

  // The pass's counts are older than its fetches. A difference only means
  // something when the server stood still meanwhile.
  it("waits for the next pass when the server changed during this one", async () => {
    const { drift, scope, server } = await syncedInbox();
    addGhostCopy();
    let inboxStatuses = 0;
    server.onStatus = (path) => {
      if (path === "INBOX") {
        inboxStatuses += 1;

        if (inboxStatuses === 2) {
          server.deliver("INBOX", genericMessage("third"));
        }
      }
    };

    await pass(scope, drift);
    expect(inboxUids()).toStrictEqual([1, 2, 3]);

    server.onStatus = undefined;
    await pass(scope, drift);
    expect(inboxUids()).toStrictEqual([1, 3, 4]);
  });

  // An unread count that is not exact would otherwise have every pass read
  // the whole mailbox again.
  it("stops comparing a count that its repair could not reconcile", async () => {
    const { drift, scope, server } = await syncedInbox();
    server.miscountedUnseen = 1;

    await pass(scope, drift);
    expect(isRereading()).toBeTruthy();
    await rereadToEnd(scope);

    await pass(scope, drift);
    expect(isRereading()).toBeFalsy();
    expect([...drift.unreconciled]).toContain("unread INBOX");

    const fetches = server.fetches.length;
    await pass(scope, drift);
    expect(isRereading()).toBeFalsy();
    expect(server.fetches).toHaveLength(fetches);
  });

  // A message the dialect cannot identify is never cached, so its mailbox
  // always has one copy fewer than the server counts.
  it("stops comparing the copies of a mailbox with a message it cannot cache", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("700", "700"));
    server.deliver(
      ALL_MAIL,
      gmailMessage("701", "701", { gmailMessageId: undefined })
    );
    const scope = scopeFor(server, gmailDialect);
    await syncFully(scope);
    const drift = makeDriftMemory();

    await pass(scope, drift);
    expect([...drift.unreconciled]).toStrictEqual([`copies ${ALL_MAIL}`]);

    const calls = server.calls.length;
    await pass(scope, drift);
    expect(server.calls.slice(calls)).toStrictEqual([]);
  });

  // The unread count means nothing while copies are still missing: judged
  // then, it would start a reread and afterwards be written off for good.
  it("fetches a large gap over several passes, and judges the unread count only after", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);

    for (let index = 0; index < 620; index += 1) {
      server.deliver("INBOX", genericMessage(`m${index}`, { flags: [] }));
    }

    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    const drift = makeDriftMemory();
    connection
      .prepare(
        "DELETE FROM mail_message_locations WHERE account_id = ? AND mailbox_path = 'INBOX' AND uid <= 600"
      )
      .run(accountId);

    await pass(scope, drift);
    expect(inboxUids()).toHaveLength(520);
    expect(isRereading()).toBeFalsy();

    await pass(scope, drift);
    expect(inboxUids()).toHaveLength(620);
    expect(isRereading()).toBeFalsy();
    expect([...drift.unreconciled]).toStrictEqual([]);
  });

  it("does not compare counts before every message is cached", async () => {
    const { drift, scope } = await syncedInbox();
    addGhostCopy();
    connection
      .prepare(
        "UPDATE mail_mailboxes SET skeleton_floor = 2 WHERE account_id = ? AND path = 'INBOX'"
      )
      .run(accountId);

    await pass(scope, drift);

    expect(inboxUids()).toStrictEqual([1, 2, 3]);
  });

  // A repair must never run inside the user's own change, or between two
  // waits on the server: those refresh a mailbox with the same code.
  it("is not made by the refresh that answers a report from the server", async () => {
    const { drift, scope, server } = await syncedInbox();
    addGhostCopy();
    const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();

    const waiting = server.nextWatch();

    const watching = run(
      watchForNews(
        { ...scope, drift },
        { arrivals: "pass", cachedPath: "INBOX", path: "INBOX" },
        {
          compare: true,
          maxMs: 300_000,
          refreshSpacingMs: 0,
          refreshed: () => Effect.void,
          stop,
        }
      )
    );

    await waiting;
    const waitingAgain = server.nextWatch();
    server.setFlags("INBOX", 1, []);
    await waitingAgain;
    Deferred.doneUnsafe(stop, Effect.void);
    await watching;

    expect(unreadThreads()).toBe(1);
    expect(inboxUids()).toStrictEqual([1, 2, 3]);
  });
});
