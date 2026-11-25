// oxlint-disable typescript/no-unsafe-type-assertion
// A pass that does not reach its end. What it saved before it failed stays
// saved, so the next pass finds that mail cached and reports nothing: the
// failing pass is the only one that can hand it over. And one folder the
// server will not open must not keep the rest of the account from syncing.
import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import type { MailEngineStore, ThreadChanges } from "@repo/mail/store";
import {
  bodyStep,
  mergeThreadChanges,
  skeletonStep,
  syncAccount,
} from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { Deferred, Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  TRASH,
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

/** Runs to the end and says how it ended: `done`, or the failure's tag. */
const attempt = (
  effect: Effect.Effect<unknown, { readonly _tag: string }, MailEngineStore>
): Promise<string> =>
  run(
    effect.pipe(
      Effect.match({
        onFailure: (error) => error._tag,
        onSuccess: () => "done",
      })
    )
  );

/** A scope that keeps what failing steps hand over, merged. */
const salvaging = (scope: SyncScope) => {
  const handed: ThreadChanges[] = [];
  return {
    salvaged: (): ThreadChanges => mergeThreadChanges(...handed),
    scope: {
      ...scope,
      salvage: (saved: ThreadChanges) =>
        Effect.sync(() => {
          handed.push(saved);
        }),
    } satisfies SyncScope,
  };
};

/** A single-part plain-text body, as the fake server serves it. */
const plainText = (text: string) => ({
  sections: { "1": text },
  structure: { size: text.length, type: "text/plain" },
});

/** Every cached message by subject, with whether its body is downloaded. */
const cachedMail = (): readonly { body_state: string; subject: string }[] =>
  connection
    .prepare(
      "SELECT subject, body_state FROM mail_messages WHERE account_id = ? ORDER BY subject"
    )
    .all(accountId) as { body_state: string; subject: string }[];

/** The mailboxes holding a copy of the message with this subject. */
const mailboxesOf = (subject: string): readonly string[] =>
  (
    connection
      .prepare(
        `SELECT location.mailbox_path AS path
         FROM mail_message_locations AS location
         JOIN mail_messages AS message
           ON message.account_id = location.account_id
          AND message.message_id = location.message_id
         WHERE location.account_id = ? AND message.subject = ?
         ORDER BY location.mailbox_path`
      )
      .all(accountId, subject) as { readonly path: string }[]
  ).map((row) => row.path);

/** A Gmail account, synced, with one unread message that has just arrived. */
const gmailWithNewMail = async () => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  server.deliver(ALL_MAIL, gmailMessage("500", "500"));
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  server.deliver(ALL_MAIL, gmailMessage("501", "501", { flags: [] }));
  return { scope, server };
};

describe("a pass that fails after saving mail", () => {
  beforeEach(resetDatabase);

  it("hands over what earlier mailboxes saved when a later one fails", async () => {
    const { scope, server } = await gmailWithNewMail();
    // All Mail is read first; the connection is lost on the way to Trash.
    server.failStatus = (path) => (path === TRASH ? "dropped" : undefined);
    const failing = salvaging(scope);

    const ending = await attempt(syncAccount(failing.scope));

    expect(ending).toBe("MailConnectionError");
    expect(failing.salvaged()).toStrictEqual({
      arrived: ["501"],
      changed: ["501"],
      removed: [],
    });
  });

  it("hands over new mail saved before its own mailbox failed", async () => {
    const { scope, server } = await gmailWithNewMail();
    // The new mail is fetched by UID and saved; the fetch of changed flags
    // that follows, over a range, is the one that loses the connection.
    server.dropFetch = (_path, selection) => selection.kind === "range";
    const failing = salvaging(scope);

    const ending = await attempt(syncAccount(failing.scope));

    expect(ending).toBe("MailConnectionError");
    expect(failing.salvaged().arrived).toStrictEqual(["501"]);
  });

  it("reports that mail once: the pass after it finds nothing new", async () => {
    const { scope, server } = await gmailWithNewMail();
    server.failStatus = (path) => (path === TRASH ? "dropped" : undefined);
    const failing = salvaging(scope);
    await attempt(syncAccount(failing.scope));
    server.failStatus = undefined;
    const retried = salvaging(scope);

    const changes = await run(syncAccount(retried.scope));

    expect(failing.salvaged().arrived).toStrictEqual(["501"]);
    expect(changes.arrived).toBeUndefined();
    expect(retried.salvaged()).toStrictEqual({ changed: [], removed: [] });
  });

  it("hands nothing over when the pass is interrupted, as on disconnect", async () => {
    const { scope, server } = await gmailWithNewMail();
    const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();
    // All Mail's new mail is saved by the time Trash is asked about.
    server.onStatus = (path) => {
      if (path === TRASH) {
        Deferred.doneUnsafe(stop, Effect.void);
      }
    };
    const interrupted = salvaging(scope);

    await run(
      syncAccount(interrupted.scope).pipe(
        Effect.raceFirst(Deferred.await(stop))
      )
    );

    expect(cachedMail().map((mail) => mail.subject)).toContain("Subject 501");
    expect(interrupted.salvaged()).toStrictEqual({ changed: [], removed: [] });
  });
});

/** A server that lists `refused` and will not open it. */
const refusing =
  (refused: string) =>
  (path: string): "refused" | undefined =>
    path === refused ? "refused" : undefined;

describe("a folder the server will not open", () => {
  beforeEach(resetDatabase);

  it("is left out, and the rest of the account syncs and indexes", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    server.deliver("INBOX", genericMessage("inbox", plainText("hello")));
    server.deliver("Receipts", genericMessage("receipt", plainText("paid")));
    // Junk is read after Receipts, so a pass that stopped there would miss it.
    server.deliver("Junk", genericMessage("junk", plainText("offer")));
    server.failStatus = refusing("Receipts");
    const scope = scopeFor(server, genericDialect);

    await syncFully(scope);
    await run(bodyStep(scope));

    expect(cachedMail()).toStrictEqual([
      { body_state: "ready", subject: "inbox" },
      { body_state: "ready", subject: "junk" },
    ]);
    // Nothing is left for the steps to trip over on the next cycle.
    await expect(run(skeletonStep(scope))).resolves.toBeUndefined();
    await expect(run(bodyStep(scope))).resolves.toBeUndefined();
  });

  it("is read again once the server opens it", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    server.deliver("Receipts", genericMessage("receipt"));
    server.failStatus = refusing("Receipts");
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    server.failStatus = undefined;

    await syncFully(scope);

    expect(mailboxesOf("receipt")).toStrictEqual(["Receipts"]);
  });

  it("keeps mail that may only have moved into it", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    const uid = server.deliver(
      "INBOX",
      genericMessage("filed", plainText("kept"))
    );
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    await run(bodyStep(scope));
    // Filed elsewhere into a folder that then will not open: the Inbox copy
    // is gone, and the pass cannot see where the message went.
    server.move("INBOX", uid, "Receipts");
    server.failStatus = refusing("Receipts");

    await run(syncAccount(scope));
    const whileRefused = cachedMail();
    server.failStatus = undefined;
    const changes = await run(syncAccount(scope));

    expect(whileRefused).toStrictEqual([
      { body_state: "ready", subject: "filed" },
    ]);
    expect(cachedMail()).toStrictEqual(whileRefused);
    expect(mailboxesOf("filed")).toStrictEqual(["Receipts"]);
    // Known mail in a new place, not new mail.
    expect(changes.arrived).toBeUndefined();
  });

  it("fails the pass when it is the Inbox: the account has not caught up", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    server.deliver("Junk", genericMessage("junk"));
    server.failStatus = refusing("INBOX");

    const ending = await attempt(syncAccount(scopeFor(server, genericDialect)));

    expect(ending).toBe("MailboxMissingError");
  });

  it("fails the pass when it is Gmail's All Mail", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.failStatus = refusing(ALL_MAIL);

    const ending = await attempt(syncAccount(scopeFor(server, gmailDialect)));

    expect(ending).toBe("MailboxMissingError");
  });

  it("fails the pass when the connection is lost instead", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    server.failStatus = (path) => (path === "Receipts" ? "dropped" : undefined);

    const ending = await attempt(syncAccount(scopeFor(server, genericDialect)));

    expect(ending).toBe("MailConnectionError");
  });

  it("still fails a pass whose folder is rebuilt after it was opened", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["CONDSTORE", "IDLE"]);
    server.deliver("Receipts", genericMessage("receipt"));
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    server.deliver("Receipts", genericMessage("another"));
    // Rebuilt between the pass's STATUS and its first read: the UIDs the
    // pass is about to ask for belong to the mailbox as it was.
    let rebuilt = false;
    server.onRead = (path) => {
      if (path === "Receipts" && !rebuilt) {
        rebuilt = true;
        server.resetUidValidity("Receipts");
      }
    };

    const ending = await attempt(syncAccount(scope));

    expect(ending).toBe("MailboxMissingError");
  });
});
