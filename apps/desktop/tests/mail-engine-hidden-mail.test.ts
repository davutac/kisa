// oxlint-disable typescript/no-unsafe-type-assertion
// Gmail lets a user hide All Mail from mail apps ("Show in IMAP", under Labels
// in its settings), and guides for other mail apps tell them to. The Gmail
// dialect reads an account's mail from All Mail alone. Taken as a mailbox
// that is gone, a hidden one would cost the account its cached mail, and an
// account connected that way would sync Spam and Trash and look complete.
import { gmailDialect } from "@repo/mail/dialects";
import { createLabel } from "@repo/mail/labels";
import type { MailEngineStore } from "@repo/mail/store";
import { bodyStep, syncAccount } from "@repo/mail/sync";
import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  accountId,
  connection,
  gmailMessage,
  insertAccount,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
} from "./fixtures/mail-engine-harness";

/** How it ended: `done`, or the failure's tag and what it says. */
const attempt = (
  effect: Effect.Effect<
    unknown,
    { readonly _tag: string; readonly message?: string },
    MailEngineStore
  >
) =>
  run(
    effect.pipe(
      Effect.match({
        onFailure: (error) => ({ message: error.message, tag: error._tag }),
        onSuccess: () => ({ message: undefined, tag: "done" }),
      })
    )
  );

const cachedMail = () =>
  connection
    .prepare(
      `SELECT message.message_id AS id, message.body_state AS body,
              count(location.uid) AS copies
       FROM mail_messages AS message
       LEFT JOIN mail_message_locations AS location
         ON location.account_id = message.account_id
        AND location.message_id = message.message_id
       WHERE message.account_id = ?
       GROUP BY message.message_id ORDER BY message.message_id`
    )
    .all(accountId);

/** A Gmail account with two messages, synced, with their bodies. */
const syncedGmail = async () => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  server.deliver(ALL_MAIL, gmailMessage("700", "700"));
  server.deliver(
    ALL_MAIL,
    gmailMessage("701", "701", { gmailLabels: ["Work"] })
  );
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  await run(bodyStep(scope));
  return { scope, server };
};

describe("a Gmail account whose All Mail is hidden from mail apps", () => {
  beforeEach(resetDatabase);

  it("fails the pass and keeps everything cached", async () => {
    const { scope, server } = await syncedGmail();
    const before = cachedMail();
    server.unlisted.add(ALL_MAIL);

    const ending = await attempt(syncAccount(scope));

    expect(ending.tag).toBe("MailHiddenError");
    expect(ending.message).toMatch(/Show in IMAP/u);
    expect(before).toStrictEqual([
      { body: "ready", copies: 1, id: "700" },
      { body: "ready", copies: 1, id: "701" },
    ]);
    expect(cachedMail()).toStrictEqual(before);
  });

  it("carries on where it was once All Mail is shown again", async () => {
    const { scope, server } = await syncedGmail();
    const before = cachedMail();
    server.unlisted.add(ALL_MAIL);
    await attempt(syncAccount(scope));
    server.unlisted.delete(ALL_MAIL);
    const fetches = server.fetches.length;

    const changes = await run(syncAccount(scope));
    const bodies = await run(bodyStep(scope));

    // Known mail, in the mailbox it was in: nothing is new, and nothing is
    // downloaded again.
    expect(changes).toStrictEqual({ changed: [], removed: [] });
    expect(cachedMail()).toStrictEqual(before);
    expect(bodies).toBeUndefined();
    expect(server.fetches).toHaveLength(fetches);
  });

  it("never syncs Spam and Trash alone for an account connected that way", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("710", "710"));
    server.unlisted.add(ALL_MAIL);

    const ending = await attempt(syncAccount(scopeFor(server, gmailDialect)));

    expect(ending.tag).toBe("MailHiddenError");
    expect(server.statuses).toStrictEqual([]);
  });

  // A label change reads the mailbox list after the server has made it, so
  // the change is on the server when the action fails. What it must not do
  // is be the pass that drops All Mail's copies.
  it("fails a label change after the server took it, without dropping All Mail's copies", async () => {
    const { scope, server } = await syncedGmail();
    const before = cachedMail();
    server.unlisted.add(ALL_MAIL);

    const ending = await attempt(createLabel(scope, "Projects"));

    expect(ending.tag).toBe("MailHiddenError");
    expect(server.calls).toContain("create Projects");
    expect(cachedMail()).toStrictEqual(before);
  });
});
