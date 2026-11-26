// oxlint-disable typescript/no-unsafe-type-assertion
// Demo mode runs the real engine against mail servers held in memory. These
// tests read the demo mailbox through the real SQLite store, as the app does,
// so a message the demo server describes wrongly fails here, not on screen.
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { dialects } from "@repo/mail/dialects";
import { SystemLabel, ThreadId, userLabelId } from "@repo/mail/ids";
import { deleteLabel, renameLabel } from "@repo/mail/labels";
import { applyThreadAction } from "@repo/mail/mutations";
import type { ThreadAction } from "@repo/mail/mutations";
import type { ImapSession } from "@repo/mail/session";
import { bodyStep, makeDriftMemory, syncAccount } from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DemoMailServer } from "../src/main/demo/demo-mail-server";
import {
  DEMO_ACCOUNTS,
  createDemoMailServers,
} from "../src/main/demo/demo-mailbox";
import type { DemoAccount } from "../src/main/demo/demo-mailbox";
import {
  enterDemoProfile,
  removeDemoProfile,
} from "../src/main/demo/demo-profile";
import { composeMessage } from "../src/main/mail/engine/outgoing-message";
import {
  connection,
  resetDatabase,
  run,
  syncFully,
} from "./fixtures/mail-engine-harness";

const NOW = Date.UTC(2026, 10, 25, 9);

const accountOn = (provider: DemoAccount["provider"]): DemoAccount => {
  const account = DEMO_ACCOUNTS.find(
    (candidate) => candidate.provider === provider
  );

  if (account === undefined) {
    throw new Error(`the demo has no ${provider} account`);
  }

  return account;
};

const work = accountOn("imap");
const gmail = accountOn("gmail");
const icloud = accountOn("icloud");
const outlook = accountOn("outlook");

/** Each account's mail as written, drawn once for the whole file. */
const written = new Map(
  DEMO_ACCOUNTS.map((account) => [account.accountId, account.threads()])
);

const writtenIn = (account: DemoAccount) =>
  written.get(account.accountId) ?? [];

const insertAccount = (account: DemoAccount): void => {
  connection
    .prepare(
      `INSERT INTO mail_accounts (account_id, created_at, credentials, dialect,
        email, imap_host, imap_port, imap_security, provider, smtp_host,
        smtp_port, smtp_security, sort_order, updated_at, username)
       VALUES (?, 0, X'00', ?, ?, ?, 993, 'tls', ?, ?, 587, 'starttls', 0, 0,
        ?)`
    )
    .run(
      account.accountId,
      account.dialect,
      account.email,
      account.host,
      account.provider,
      account.host,
      account.email
    );
};

/** Everything the account's server holds, cached with its bodies. */
const syncAll = async (scope: SyncScope): Promise<void> => {
  await syncFully(scope);

  for (let step = 0; step < 100; step += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop
    if ((await run(bodyStep(scope))) === undefined) {
      return;
    }
  }

  throw new Error("bodies did not finish");
};

const serverOf = (
  servers: ReadonlyMap<string, DemoMailServer>,
  account: DemoAccount
): DemoMailServer => {
  const server = servers.get(account.accountId);

  if (server === undefined) {
    throw new Error("no demo server for the account");
  }

  return server;
};

/** Connects an account to its demo server and caches all of its mail. */
const connect = async (
  servers: ReadonlyMap<string, DemoMailServer>,
  account: DemoAccount
): Promise<SyncScope> => {
  insertAccount(account);

  const scope: SyncScope = {
    accountId: account.accountId,
    dialect: dialects[account.dialect],
    session: serverOf(servers, account).session(),
  };

  await syncAll(scope);

  return scope;
};

interface ThreadRow {
  readonly has_attachments: number;
  readonly label_ids: string;
  readonly is_in_inbox: number;
  readonly is_in_sent: number;
  readonly is_in_spam: number;
  readonly is_in_trash: number;
  readonly is_unread: number;
  readonly message_count: number;
  readonly snippet: string;
  readonly subject: string;
  readonly thread_id: string;
}

const threadsOf = (account: DemoAccount): readonly ThreadRow[] =>
  connection
    .prepare<unknown[], ThreadRow>(
      `SELECT thread_id, message_count, is_in_inbox, is_in_sent, is_in_spam,
              is_in_trash, is_unread, subject, snippet, has_attachments,
              label_ids
       FROM mail_threads WHERE account_id = ?`
    )
    .all(account.accountId);

const threadNamed = (account: DemoAccount, subject: string): ThreadRow => {
  const row = threadsOf(account).find(
    (candidate) => candidate.subject.replace(/^Re: /u, "") === subject
  );

  if (row === undefined) {
    throw new Error(`no thread ${subject}`);
  }

  return row;
};

const bodyStates = (account: DemoAccount): readonly string[] =>
  connection
    .prepare<unknown[], { readonly body_state: string }>(
      "SELECT body_state FROM mail_messages WHERE account_id = ?"
    )
    .all(account.accountId)
    .map((row) => row.body_state);

const subjectsOf = (account: DemoAccount): ReadonlySet<string> =>
  new Set(writtenIn(account).map((conversation) => conversation.subject));

const messageCount = (account: DemoAccount): number =>
  writtenIn(account).reduce(
    (total, conversation) => total + conversation.messages.length,
    0
  );

const section = (
  session: ImapSession,
  mailboxPath: string,
  uid: number,
  part: string
): Promise<Uint8Array | undefined> =>
  Effect.runPromise(
    Effect.gen(function* fetchPart() {
      const { uidValidity } = yield* session.status(mailboxPath);

      return yield* session.fetchSection(
        mailboxPath,
        uidValidity,
        uid,
        part,
        1e9
      );
    })
  );

describe("demo mailbox", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("has one account on each provider", () => {
    expect(
      DEMO_ACCOUNTS.map(({ dialect, provider }) => [provider, dialect])
    ).toStrictEqual([
      ["imap", "generic"],
      ["gmail", "gmail"],
      ["icloud", "generic"],
      ["outlook", "generic"],
    ]);
  });

  it("caches every message of every account with its body", async () => {
    const servers = createDemoMailServers(NOW);

    for (const account of DEMO_ACCOUNTS) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await connect(servers, account);
    }

    for (const account of DEMO_ACCOUNTS) {
      const states = bodyStates(account);

      expect(states).toHaveLength(messageCount(account));
      expect(new Set(states)).toStrictEqual(new Set(["ready"]));
      // No two conversations were threaded together, and none was split.
      expect(threadsOf(account)).toHaveLength(writtenIn(account).length);
    }
  });

  it("threads replies and files mail where the folders say", async () => {
    const servers = createDemoMailServers(NOW);

    await connect(servers, work);

    expect(threadNamed(work, "Rebrand: round two feedback")).toMatchObject({
      has_attachments: 1,
      is_in_inbox: 1,
      is_in_sent: 1,
      is_unread: 1,
      message_count: 4,
    });
    expect(
      threadNamed(work, "You have been selected for a design award")
    ).toMatchObject({ is_in_inbox: 0, is_in_spam: 1 });
    expect(threadNamed(work, "Your lunch order is on its way")).toMatchObject({
      is_in_inbox: 0,
      is_in_trash: 1,
    });
    expect(
      threadNamed(work, "Proposal: Tidewater spring campaign")
    ).toMatchObject({ is_in_inbox: 0, is_in_sent: 1 });
    expect(
      threadNamed(work, "Contract for the spring campaign").snippet
    ).toContain("Legal has approved the statement of work");
  });

  it("keeps each account's mail to that account", async () => {
    const servers = createDemoMailServers(NOW);

    for (const account of DEMO_ACCOUNTS) {
      // oxlint-disable-next-line eslint/no-await-in-loop
      await connect(servers, account);
    }

    for (const account of DEMO_ACCOUNTS) {
      const cached = threadsOf(account).map((row) =>
        row.subject.replace(/^Re: /u, "")
      );

      expect(new Set(cached)).toStrictEqual(subjectsOf(account));
    }
  });

  it("serves an attachment's bytes under the part the cache lists", async () => {
    const servers = createDemoMailServers(NOW);
    const scope = await connect(servers, work);

    const cached = connection
      .prepare<
        unknown[],
        {
          readonly attachments: string;
          readonly mailbox_path: string;
          readonly uid: number;
        }
      >(
        `SELECT message.attachments, location.mailbox_path, location.uid
         FROM mail_messages AS message
         JOIN mail_message_locations AS location
           ON location.account_id = message.account_id
          AND location.message_id = message.message_id
         WHERE message.account_id = ? AND message.subject = ?
           AND location.mailbox_path = 'INBOX'`
      )
      .get(work.accountId, "Contract for the spring campaign");

    // SAFETY: the store writes this column as its list of attachments.
    const [attachment] = JSON.parse(cached?.attachments ?? "[]") as {
      readonly filename: string;
      readonly section: string;
    }[];

    expect(attachment?.filename).toBe("Tidewater-Spring-Campaign-SOW.pdf");

    const bytes = await section(
      scope.session,
      cached?.mailbox_path ?? "",
      cached?.uid ?? 0,
      attachment?.section ?? ""
    );

    expect(
      Buffer.from(Buffer.from(bytes ?? []).toString("latin1"), "base64")
        .subarray(0, 8)
        .toString("latin1")
    ).toBe("%PDF-1.4");
  });

  it("takes the changes a user makes, as a mail server does", async () => {
    const servers = createDemoMailServers(NOW);
    const scope = await connect(servers, work);
    const subject = "Podcast interview next month?";
    const { thread_id: threadId } = threadNamed(work, subject);

    const apply = (action: ThreadAction) =>
      run(applyThreadAction(scope, [ThreadId.make(threadId)], action));

    await apply({
      applied: false,
      kind: "setLabel",
      labelId: SystemLabel.inbox,
    });

    expect(threadNamed(work, subject)).toMatchObject({ is_in_inbox: 0 });

    await apply({ kind: "trash" });

    expect(threadNamed(work, subject)).toMatchObject({ is_in_trash: 1 });

    // A restore puts mail back where Trash took it from, which was Archive.
    await apply({ kind: "moveToInbox" });

    expect(threadNamed(work, subject)).toMatchObject({
      is_in_inbox: 0,
      is_in_trash: 0,
    });

    await apply({
      applied: true,
      kind: "setLabel",
      labelId: SystemLabel.inbox,
    });
    await apply({ kind: "setRead", read: false });
    await apply({
      applied: true,
      kind: "setLabel",
      labelId: userLabelId("Hiring"),
    });

    expect(threadNamed(work, subject)).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      is_unread: 1,
    });

    // A full pass finds the server as the cache already has it.
    const before = threadsOf(work);
    await syncAll(scope);

    expect(threadsOf(work)).toStrictEqual(before);
  });

  // The app's background pass holds the cache against the server's counts
  // and repairs a difference, with a warning. Counts that were off by one
  // here would have it repair the demo mailbox on every poll.
  it.each(DEMO_ACCOUNTS)(
    "gives the background pass nothing to repair on $provider",
    async (account) => {
      const servers = createDemoMailServers(NOW);
      const scope = await connect(servers, account);
      const drift = makeDriftMemory();
      const before = threadsOf(account);

      await run(syncAccount({ ...scope, drift }));
      await run(syncAccount({ ...scope, drift }));

      expect([...drift.rereading]).toStrictEqual([]);
      expect([...drift.unreconciled]).toStrictEqual([]);
      expect(threadsOf(account)).toStrictEqual(before);
    }
  );

  it("renames and deletes folders without losing their mail", async () => {
    const servers = createDemoMailServers(NOW);
    const scope = await connect(servers, work);

    await run(renameLabel(scope, userLabelId("Hiring"), "People"));

    expect(
      JSON.parse(
        threadNamed(work, "Application: senior brand designer").label_ids
      )
    ).toContain(userLabelId("People"));

    // A deleted folder's mail moves to Archive first, so none of it is lost.
    await run(deleteLabel(scope, userLabelId("Receipts")));

    expect(
      threadNamed(work, "Receipt for Fernhill Studio, November")
    ).toMatchObject({ is_in_trash: 0, message_count: 1 });

    // A full pass finds the server as the cache already has it.
    const before = threadsOf(work);
    await syncAll(scope);

    expect(threadsOf(work)).toStrictEqual(before);
    expect(threadsOf(work)).toHaveLength(writtenIn(work).length);
  });

  it("files a reply Kisa appends to Sent in its conversation, with its text", async () => {
    const servers = createDemoMailServers(NOW);
    const scope = await connect(servers, work);
    const subject = "Contract for the spring campaign";

    const original = connection
      .prepare<unknown[], { readonly rfc822_message_id: string }>(
        `SELECT rfc822_message_id FROM mail_messages
         WHERE account_id = ? AND subject = ?`
      )
      .get(work.accountId, subject);

    const reply = composeMessage({
      attachments: [],
      bcc: [],
      body: {
        html: "<p>Countersigned — Zoë has the copy ✓</p>",
        text: "Countersigned — Zoë has the copy ✓",
      },
      cc: [],
      date: new Date(NOW),
      from: { address: work.email, name: work.displayName },
      inReplyTo: original?.rfc822_message_id,
      messageId: "reply-1@fernhill.example",
      references: [original?.rfc822_message_id ?? ""],
      subject: `Re: ${subject} — für Zoë`,
      to: [{ address: "priya@tidewater.example", name: "Priya Raman" }],
    });

    // What the engine asks before it files a Sent copy, so a retry of the
    // send never leaves two.
    const isFiled = () =>
      Effect.runPromise(
        scope.session.hasMessage("Sent", {
          kind: "header",
          name: "Message-ID",
          value: `<${reply.messageId}>`,
        })
      );

    await expect(isFiled()).resolves.toBeFalsy();

    await Effect.runPromise(
      scope.session.append("Sent", reply.sentCopy, ["\\Seen"])
    );

    await expect(isFiled()).resolves.toBeTruthy();
    await run(syncAccount(scope));
    await syncAll(scope);

    const conversation = threadNamed(work, subject);

    expect(conversation).toMatchObject({ is_in_sent: 1, message_count: 2 });
    expect(threadsOf(work)).toHaveLength(writtenIn(work).length);

    const sent = connection
      .prepare<
        unknown[],
        { readonly body_text: string; readonly subject: string }
      >(
        `SELECT body_text, subject FROM mail_messages
         WHERE account_id = ? AND rfc822_message_id = ?`
      )
      .get(work.accountId, "reply-1@fernhill.example");

    expect(sent).toStrictEqual({
      body_text: "Countersigned — Zoë has the copy ✓",
      subject: `Re: ${subject} — für Zoë`,
    });
  });

  it("reads the Gmail account as Gmail keeps it: one copy, with labels", async () => {
    const servers = createDemoMailServers(NOW);

    await connect(servers, gmail);

    const trip = threadNamed(gmail, "Your trip to Lisbon is confirmed");

    expect(trip).toMatchObject({ is_in_inbox: 1, is_in_spam: 0 });
    expect(JSON.parse(trip.label_ids)).toStrictEqual(
      expect.arrayContaining([
        SystemLabel.important,
        SystemLabel.starred,
        userLabelId("Travel"),
      ])
    );
    expect(threadNamed(gmail, "Receipt from Kettle Books")).toMatchObject({
      is_in_inbox: 0,
      label_ids: JSON.stringify([userLabelId("Receipts")]),
    });
    expect(threadNamed(gmail, "Photos from the hike")).toMatchObject({
      is_in_inbox: 1,
      is_in_sent: 1,
      message_count: 3,
    });
    expect(
      threadNamed(gmail, "Action needed: your parcel is waiting")
    ).toMatchObject({ is_in_inbox: 0, is_in_spam: 1 });
  });

  it("takes changes to the Gmail account as Gmail does", async () => {
    const servers = createDemoMailServers(NOW);
    const scope = await connect(servers, gmail);
    const subject = "Book club: the November pick";
    const { thread_id: threadId } = threadNamed(gmail, subject);

    const apply = (action: ThreadAction) =>
      run(applyThreadAction(scope, [ThreadId.make(threadId)], action));

    await apply({
      applied: false,
      kind: "setLabel",
      labelId: SystemLabel.inbox,
    });
    await apply({
      applied: true,
      kind: "setLabel",
      labelId: userLabelId("Travel"),
    });

    expect(threadNamed(gmail, subject)).toMatchObject({
      is_in_inbox: 0,
      is_in_sent: 1,
      label_ids: JSON.stringify([SystemLabel.sent, userLabelId("Travel")]),
    });

    await apply({ kind: "trash" });

    expect(threadNamed(gmail, subject)).toMatchObject({ is_in_trash: 1 });

    await apply({ kind: "moveToInbox" });

    expect(threadNamed(gmail, subject)).toMatchObject({
      is_in_inbox: 1,
      is_in_trash: 0,
      message_count: 2,
    });

    await run(deleteLabel(scope, userLabelId("Travel")));

    expect(JSON.parse(threadNamed(gmail, subject).label_ids)).not.toContain(
      userLabelId("Travel")
    );

    // A full pass finds the server as the cache already has it.
    const before = threadsOf(gmail);
    await syncAll(scope);

    expect(threadsOf(gmail)).toStrictEqual(before);
  });

  // Gmail and Outlook keep what their SMTP server accepted; for the others
  // the engine appends the copy itself, so the server must not add a second.
  it.each([
    { account: gmail, files: 1, subject: "Photos from the hike" },
    { account: outlook, files: 1, subject: "Papers for the tax return" },
    { account: icloud, files: 0, subject: "Pappa turns 70: the plan" },
    { account: work, files: 0, subject: "Quick question about the logo files" },
  ])(
    "keeps $files copy of mail sent from $account.provider",
    async ({ account, files, subject }) => {
      const servers = createDemoMailServers(NOW);
      const scope = await connect(servers, account);
      const before = threadNamed(account, subject);

      // The conversation so far, oldest first, as a reply's References are.
      const earlier = connection
        .prepare<unknown[], { readonly rfc822_message_id: string }>(
          `SELECT rfc822_message_id FROM mail_messages
           WHERE account_id = ? AND thread_id = ?
           ORDER BY received_at`
        )
        .all(account.accountId, before.thread_id)
        .map((row) => row.rfc822_message_id);

      const reply = composeMessage({
        attachments: [],
        bcc: [],
        body: { html: "<p>Sounds good.</p>", text: "Sounds good." },
        cc: [],
        date: new Date(NOW),
        from: { address: account.email, name: account.displayName },
        inReplyTo: earlier.at(-1),
        messageId: `sent-1@${account.host}`,
        references: earlier,
        subject: `Re: ${subject}`,
        to: [{ address: "someone@elsewhere.example" }],
      });

      serverOf(servers, account).acceptSent(reply.transmitted);
      await run(syncAccount(scope));
      await syncAll(scope);

      expect(threadNamed(account, subject)).toMatchObject({
        is_in_sent: 1,
        message_count: before.message_count + files,
      });
      // The copy joined its conversation, and started no new one.
      expect(threadsOf(account)).toHaveLength(writtenIn(account).length);
      expect(new Set(bodyStates(account))).toStrictEqual(new Set(["ready"]));
    }
  );
});

describe("demo profile", () => {
  const made: string[] = [];

  /** Electron's paths as a test sees them; `resolved` is what it reports. */
  const fakeApp = (resolved?: string) => {
    const paths = new Map<string, string>();

    return {
      getPath: (name: string) => resolved ?? paths.get(name) ?? "",
      paths,
      setPath: (name: string, value: string) => {
        paths.set(name, value);
        made.push(value);
      },
    };
  };

  afterEach(() => {
    removeDemoProfile();

    for (const directory of made.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("moves user data and session data into a new temporary directory", () => {
    const app = fakeApp();

    expect(enterDemoProfile(app)).toBeTruthy();

    const profile = app.paths.get("userData") ?? "";

    expect(app.paths.get("sessionData")).toBe(profile);
    expect(path.dirname(profile)).toBe(realpathSync(tmpdir()));
    expect(existsSync(profile)).toBeTruthy();

    removeDemoProfile();

    expect(existsSync(profile)).toBeFalsy();
  });

  // Starting then would open the real profile with the demo's servers.
  it("refuses to start when Electron is still in another profile", () => {
    const real = mkdtempSync(path.join(tmpdir(), "kisa-real-"));
    made.push(real);

    expect(enterDemoProfile(fakeApp(real))).toBeFalsy();

    removeDemoProfile();

    expect(existsSync(real)).toBeTruthy();
  });

  it("refuses to start when the profile cannot be set", () => {
    expect(
      enterDemoProfile({
        getPath: () => "",
        setPath: () => {
          throw new Error("refused");
        },
      })
    ).toBeFalsy();
  });
});
