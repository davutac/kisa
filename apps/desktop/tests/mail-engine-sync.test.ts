// oxlint-disable typescript/no-unsafe-type-assertion
import { gunzipSync } from "node:zlib";

import { genericDialect, gmailDialect } from "@repo/mail/dialects";
import { ThreadId } from "@repo/mail/ids";
import { setThreadRead } from "@repo/mail/mutations";
import { MailEngineStore } from "@repo/mail/store";
import {
  bodyStep,
  loadThreadBodies,
  skeletonStep,
  syncAccount,
} from "@repo/mail/sync";
import type { SyncScope } from "@repo/mail/sync";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeImapServer, envelope } from "./fixtures/fake-imap-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  TRASH,
  connection,
  genericMessage,
  gmailMessage,
  insertAccount,
  messageRow,
  resetDatabase,
  run,
  scopeFor,
  syncFully,
  threadRow,
} from "./fixtures/mail-engine-harness";

const REPORT_STRUCTURE = {
  childNodes: [
    {
      childNodes: [
        { part: "1.1", size: 10, type: "text/plain" },
        { encoding: "base64", part: "1.2", size: 20, type: "text/html" },
      ],
      part: "1",
      type: "multipart/alternative",
    },
    {
      disposition: "attachment",
      dispositionParameters: { filename: "report.pdf" },
      encoding: "base64",
      part: "2",
      size: 5000,
      type: "application/pdf",
    },
  ],
  type: "multipart/mixed",
};

/** Two messages, synced, with one batch of bodies downloaded. */
const syncTwoBodies = async (): Promise<SyncScope> => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  server.deliver(ALL_MAIL, gmailMessage("200", "200"));
  server.deliver(
    ALL_MAIL,
    gmailMessage("201", "201", {
      sections: { "1.2": "PGk+cmVwb3J0PC9pPg==" },
      structure: REPORT_STRUCTURE,
    })
  );
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  await run(bodyStep(scope));
  return scope;
};

/** A two-message conversation, synced with bodies; returns the first UID. */
const syncConversation = async () => {
  insertAccount("gmail");
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  const first = server.deliver(
    ALL_MAIL,
    gmailMessage("300", "300", { flags: [] })
  );
  server.deliver(ALL_MAIL, gmailMessage("301", "300"));
  const scope = scopeFor(server, gmailDialect);
  await syncFully(scope);
  await run(loadThreadBodies(scope, ThreadId.make("300")));
  return { first, scope, server };
};

describe("mail engine with the Gmail dialect", () => {
  beforeEach(resetDatabase);

  it("builds the whole mailbox newest first and threads by Gmail's ids", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("100", "100", { flags: [] }));
    server.skipUids(ALL_MAIL, 50);
    server.deliver(
      ALL_MAIL,
      gmailMessage("101", "100", { gmailLabels: ["\\Inbox", "\\Sent"] })
    );
    server.deliver(
      ALL_MAIL,
      gmailMessage("102", "102", { gmailLabels: ["Work"] })
    );

    await syncFully(scopeFor(server, gmailDialect));

    expect(threadRow("100")).toMatchObject({
      is_in_inbox: 1,
      is_in_sent: 1,
      is_unread: 1,
      message_count: 2,
      subject: "Subject 100",
    });
    expect(threadRow("102")).toMatchObject({
      is_in_inbox: 0,
      label_ids: JSON.stringify(["u:Work"]),
    });
    expect(
      connection
        .prepare(
          "SELECT label_id, name FROM mail_labels WHERE kind = 'user' ORDER BY label_id"
        )
        .all()
    ).toStrictEqual([{ label_id: "u:Work", name: "Work" }]);
    expect(
      connection
        .prepare(
          "SELECT path, synced, skeleton_floor FROM mail_mailboxes WHERE synced = 1 ORDER BY path"
        )
        .all()
    ).toStrictEqual([
      { path: ALL_MAIL, skeleton_floor: 1, synced: 1 },
      { path: "[Gmail]/Spam", skeleton_floor: 1, synced: 1 },
      { path: TRASH, skeleton_floor: 1, synced: 1 },
    ]);
  });

  it("walks a sparse mailbox larger than one batch", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    for (let index = 0; index < 1300; index += 1) {
      server.deliver(
        ALL_MAIL,
        gmailMessage(String(1000 + index), String(1000 + index))
      );
      server.skipUids(ALL_MAIL, index % 7);
    }

    await syncFully(scopeFor(server, gmailDialect));

    expect(
      connection.prepare("SELECT count(*) AS count FROM mail_messages").get()
    ).toStrictEqual({ count: 1300 });
  });

  it("stores HTML, its searchable text and a snippet, trusting Gmail's authentication", async () => {
    await syncTwoBodies();

    const plain = messageRow("200");
    expect(plain).toMatchObject({
      body_state: "ready",
      body_text: "Hello & welcome ✓",
      sender_authenticated: 1,
      snippet: "Hello & welcome ✓",
    });
    expect(gunzipSync(plain?.body_html ?? Buffer.alloc(0)).toString()).toBe(
      "<p>Hello &amp; <b>welcome</b> ✓</p>"
    );
  });

  it("downloads only the HTML alternative and lists attachments without their bytes", async () => {
    const scope = await syncTwoBodies();

    expect(messageRow("201")).toMatchObject({ body_text: "report" });
    expect(JSON.parse(messageRow("201")?.attachments ?? "null")).toStrictEqual([
      {
        disposition: "attachment",
        encoding: "base64",
        filename: "report.pdf",
        mediaType: "application/pdf",
        section: "2",
        size: 5000,
      },
    ]);
    expect(threadRow("201")).toMatchObject({
      has_attachments: 1,
      snippet: "report",
    });
    await expect(run(bodyStep(scope))).resolves.toBeUndefined();
  });

  it("follows read state and new mail", async () => {
    const { first, scope, server } = await syncConversation();
    expect(threadRow("300")).toMatchObject({ is_unread: 1, message_count: 2 });

    server.setFlags(ALL_MAIL, first, ["\\Seen"]);
    server.deliver(ALL_MAIL, gmailMessage("302", "302"));
    const changes = await run(syncAccount(scope));

    expect(changes.changed).toStrictEqual(
      expect.arrayContaining(["300", "302"])
    );
    expect(threadRow("300")).toMatchObject({ is_unread: 0 });
    expect(threadRow("302")).toMatchObject({ message_count: 1 });
  });

  it("keeps a message and its body when Gmail moves it to Trash", async () => {
    const { first, scope, server } = await syncConversation();

    server.move(ALL_MAIL, first, TRASH);
    await run(syncAccount(scope));

    expect(messageRow("300")).toMatchObject({
      body_state: "ready",
      label_ids: JSON.stringify(["INBOX", "UNREAD", "TRASH"]),
    });
    expect(threadRow("300")).toMatchObject({ is_in_inbox: 1, is_in_trash: 1 });
  });

  it("removes a message deleted for good, then its empty thread", async () => {
    const { first, scope, server } = await syncConversation();
    const trashed = server.move(ALL_MAIL, first, TRASH);
    await run(syncAccount(scope));

    server.expunge(TRASH, trashed);
    const removal = await run(syncAccount(scope));
    expect(messageRow("300")).toBeUndefined();
    expect(threadRow("300")).toMatchObject({
      is_in_trash: 0,
      message_count: 1,
    });
    expect(removal.changed).toContain("300");

    server.expunge(ALL_MAIL, 2);
    const emptied = await run(syncAccount(scope));
    expect(emptied.removed).toStrictEqual(["300"]);
  });

  it("marks a conversation read and unread on the server, then in the cache", async () => {
    const { scope, server } = await syncConversation();

    await run(setThreadRead(scope, ThreadId.make("300"), true));
    expect(threadRow("300")).toMatchObject({ is_unread: 0 });
    expect(server.calls).toContain(`store ${ALL_MAIL} add \\Seen`);

    await run(setThreadRead(scope, ThreadId.make("300"), false));
    expect(threadRow("300")).toMatchObject({ is_unread: 1 });
    // The server now has the same flags, so the next sync changes nothing.
    const changes = await run(syncAccount(scope));
    expect(changes.changed).toStrictEqual([]);
  });

  it("forgets everything cached for a disconnected account", async () => {
    const { scope } = await syncConversation();

    await run(
      MailEngineStore.use((store) => store.clearAccount(scope.accountId))
    );

    for (const table of [
      "mail_labels",
      "mail_mailboxes",
      "mail_message_locations",
      "mail_messages",
      "mail_threads",
    ]) {
      expect(
        connection.prepare(`SELECT count(*) AS count FROM ${table}`).get()
      ).toStrictEqual({ count: 0 });
    }
  });

  it("picks up label changes through CONDSTORE", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    const uid = server.deliver(ALL_MAIL, gmailMessage("400", "400"));
    const scope = scopeFor(server, gmailDialect);
    await syncFully(scope);

    server.setGmailLabels(ALL_MAIL, uid, ["Work"]);
    await run(syncAccount(scope));

    expect(threadRow("400")).toMatchObject({
      is_in_inbox: 0,
      label_ids: JSON.stringify(["u:Work"]),
    });
  });

  it("reports mail found after the walk as new, never the walk or a move", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    const known = server.deliver(
      ALL_MAIL,
      gmailMessage("700", "700", { flags: [] })
    );
    const scope = scopeFor(server, gmailDialect);
    await run(syncAccount(scope));
    const walked = await run(skeletonStep(scope));

    server.deliver(ALL_MAIL, gmailMessage("701", "701", { flags: [] }));
    server.move(ALL_MAIL, known, TRASH);
    const synced = await run(syncAccount(scope));

    expect(walked).toStrictEqual({ changed: ["700"], removed: [] });
    expect(synced.arrived).toStrictEqual(["701"]);
  });

  it("starts a mailbox over when UIDVALIDITY changes, keeping its messages", async () => {
    insertAccount("gmail");
    const server = new FakeImapServer(GMAIL_MAILBOXES);
    server.deliver(ALL_MAIL, gmailMessage("500", "500"));
    const scope = scopeFor(server, gmailDialect);
    await syncFully(scope);
    await run(bodyStep(scope));

    server.resetUidValidity(ALL_MAIL);
    await syncFully(scope);

    expect(messageRow("500")).toMatchObject({ body_state: "ready" });
    expect(threadRow("500")).toMatchObject({ is_in_inbox: 1 });
  });
});

// ---------------------------------------------------------------- Generic

describe("mail engine with the generic dialect", () => {
  beforeEach(resetDatabase);

  it("treats copies in two folders as one message with both labels", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
    const inboxUid = server.deliver(
      "INBOX",
      genericMessage("x", { flags: [] })
    );
    server.deliver("Receipts", genericMessage("x"));
    server.deliver(
      "Sent Messages",
      genericMessage("y", {
        envelope: envelope({
          inReplyTo: "<x@example.com>",
          messageId: "<y@example.com>",
          subject: "Re: x",
        }),
        headers: { references: "<x@example.com>" },
        internalDate: 1_700_000_100_000,
      })
    );
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);

    const [message] = connection
      .prepare(
        "SELECT message_id, thread_id, label_ids, is_unread FROM mail_messages WHERE subject = 'x'"
      )
      .all() as { message_id: string; thread_id: string }[];
    expect(message).toMatchObject({
      is_unread: 1,
      label_ids: JSON.stringify(["INBOX", "UNREAD", "u:Receipts"]),
    });
    expect(threadRow(message?.thread_id ?? "")).toMatchObject({
      is_in_inbox: 1,
      is_in_sent: 1,
      message_count: 2,
    });

    // Another client archives the Inbox copy; without CONDSTORE the count
    // mismatch reveals it, and the message keeps its id.
    server.move("INBOX", inboxUid, "Archive");
    await run(syncAccount(scope));

    expect(messageRow(message?.message_id ?? "")).toMatchObject({
      label_ids: JSON.stringify(["UNREAD", "u:Receipts"]),
    });
    expect(threadRow(message?.thread_id ?? "")).toMatchObject({
      is_in_inbox: 0,
    });
  });

  it("never trusts a Gmail authentication header on another provider", async () => {
    insertAccount("generic");
    const server = new FakeImapServer(ICLOUD_MAILBOXES, ["IDLE"]);
    server.deliver(
      "INBOX",
      genericMessage("z", {
        headers: {
          "authentication-results":
            "mx.google.com; dmarc=pass (p=REJECT) header.from=example.com",
        },
        sections: { "1": "forged" },
        structure: { size: 6, type: "text/plain" },
      })
    );
    const scope = scopeFor(server, genericDialect);
    await syncFully(scope);
    await run(bodyStep(scope));

    expect(
      connection
        .prepare("SELECT sender_authenticated, body_text FROM mail_messages")
        .get()
    ).toStrictEqual({ body_text: "forged", sender_authenticated: 0 });
  });
});
