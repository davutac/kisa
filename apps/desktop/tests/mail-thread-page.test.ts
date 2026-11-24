import { Schema } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import { readThreadPage } from "../src/main/mail/engine/mail-reads";
import { MailCachedThreadPageRequest } from "../src/shared/ipc/mail";
import type { MailboxPlace } from "../src/shared/ipc/mail";
import {
  connection,
  remoteDatabase,
  resetDatabase,
} from "./fixtures/mail-engine-harness";

const ONE = "one@example.com";
const TWO = "two@example.com";

const insertThread = (
  accountId: string,
  threadId: string,
  labelIds: readonly string[],
  latestAt = 1000
): void => {
  connection
    .prepare(
      `INSERT INTO mail_threads (account_id, attachments, from_address,
        has_attachments, is_in_inbox, is_in_sent, is_in_spam, is_in_trash,
        is_unread, label_ids, latest_at, latest_message_id, message_count,
        snippet, subject, thread_id, updated_at)
       VALUES (?, '[]', 'sender@example.com', 0, ?, ?, ?, ?, 0, ?, ?, 'm', 1,
        '', 'Subject', ?, 0)`
    )
    .run(
      accountId,
      Number(labelIds.includes("INBOX")),
      Number(labelIds.includes("SENT")),
      Number(labelIds.includes("SPAM")),
      Number(labelIds.includes("TRASH")),
      JSON.stringify(labelIds),
      latestAt,
      threadId
    );
};

const listIds = async (
  mailbox: MailboxPlace,
  accountIds: readonly string[] = [ONE, TWO]
): Promise<readonly string[]> => {
  const page = await readThreadPage(remoteDatabase, { accountIds, mailbox });
  return page.threads.map(
    ({ accountId, threadId }) => `${accountId}:${threadId}`
  );
};

describe("label places", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("lists a label's conversations whether or not they are in the Inbox", async () => {
    insertThread(ONE, "inbox", ["INBOX", "u:Work"], 3000);
    insertThread(ONE, "archived", ["u:Work"], 2000);
    insertThread(ONE, "sent", ["SENT", "u:Work"], 1000);
    insertThread(ONE, "unlabelled", ["INBOX"], 4000);

    await expect(listIds({ label: "Work" })).resolves.toStrictEqual([
      `${ONE}:inbox`,
      `${ONE}:archived`,
      `${ONE}:sent`,
    ]);
    // The Inbox itself leaves archived mail out, and mail only in Sent.
    await expect(listIds("inbox")).resolves.toStrictEqual([
      `${ONE}:unlabelled`,
      `${ONE}:inbox`,
    ]);
  });

  it("lists starred conversations wherever they are, outside Spam and Trash", async () => {
    insertThread(ONE, "inbox", ["INBOX", "STARRED"], 5000);
    insertThread(TWO, "archived", ["STARRED"], 4000);
    insertThread(ONE, "plain", ["INBOX"], 3000);
    insertThread(ONE, "spam", ["SPAM", "STARRED"], 2000);
    // A user label named like the system one is not a star.
    insertThread(ONE, "named", ["u:STARRED"], 1000);

    await expect(listIds("starred")).resolves.toStrictEqual([
      `${ONE}:inbox`,
      `${TWO}:archived`,
    ]);
    await expect(listIds("starred", [TWO])).resolves.toStrictEqual([
      `${TWO}:archived`,
    ]);
  });

  it("leaves Spam and Trash out of a label", async () => {
    insertThread(ONE, "kept", ["u:Work"], 3000);
    insertThread(ONE, "spam", ["SPAM", "u:Work"], 2000);
    insertThread(ONE, "trash", ["TRASH", "u:Work"], 1000);

    await expect(listIds({ label: "Work" })).resolves.toStrictEqual([
      `${ONE}:kept`,
    ]);
  });

  it("matches the label without regard to case, but not its children", async () => {
    insertThread(ONE, "upper", ["u:Work"], 3000);
    insertThread(TWO, "lower", ["u:work"], 2000);
    insertThread(ONE, "child", ["u:Work/Clients"], 1000);

    await expect(listIds({ label: "WORK" })).resolves.toStrictEqual([
      `${ONE}:upper`,
      `${TWO}:lower`,
    ]);
    await expect(listIds({ label: "work/clients" })).resolves.toStrictEqual([
      `${ONE}:child`,
    ]);
  });

  it("matches a label with capitals outside ASCII", async () => {
    insertThread(ONE, "doctors", ["u:Ärzte"], 2000);
    insertThread(ONE, "overview", ["u:Übersicht/Ärzte"], 1000);

    await expect(listIds({ label: "Ärzte" })).resolves.toStrictEqual([
      `${ONE}:doctors`,
    ]);
    await expect(listIds({ label: "Übersicht/Ärzte" })).resolves.toStrictEqual([
      `${ONE}:overview`,
    ]);
  });

  it("keeps another account's colliding thread out of a one-account scope", async () => {
    insertThread(ONE, "shared-id", ["u:Work"], 2000);
    insertThread(TWO, "shared-id", ["u:Work"], 1000);

    await expect(listIds({ label: "Work" }, [TWO])).resolves.toStrictEqual([
      `${TWO}:shared-id`,
    ]);
  });

  it("lists a folder named like a mailbox as that folder", async () => {
    insertThread(ONE, "folder", ["u:Spam"], 2000);
    insertThread(ONE, "junk", ["SPAM"], 1000);

    await expect(listIds({ label: "Spam" })).resolves.toStrictEqual([
      `${ONE}:folder`,
    ]);
    await expect(listIds("spam")).resolves.toStrictEqual([`${ONE}:junk`]);
  });

  it("pages a sparse label without short pages", async () => {
    for (let index = 0; index < 160; index += 1) {
      insertThread(
        ONE,
        `t${String(index).padStart(3, "0")}`,
        index % 3 === 0 ? ["u:Rare"] : ["INBOX"],
        10_000 - index
      );
    }

    const first = await readThreadPage(remoteDatabase, {
      accountIds: [ONE],
      mailbox: { label: "Rare" },
    });
    const second = await readThreadPage(remoteDatabase, {
      accountIds: [ONE],
      cursor: first.nextCursor,
      mailbox: { label: "Rare" },
    });

    expect(first.threads).toHaveLength(50);
    expect(first.nextCursor).toBeDefined();
    expect(second.threads).toHaveLength(4);
    expect(second.nextCursor).toBeUndefined();
  });
});

describe("thread page requests", () => {
  const decode = Schema.decodeUnknownSync(MailCachedThreadPageRequest);

  it("carries either a mailbox or a label", () => {
    expect(decode({ accountIds: [ONE], mailbox: "sent" }).mailbox).toBe("sent");
    expect(
      decode({ accountIds: [ONE], mailbox: { label: "Work" } }).mailbox
    ).toStrictEqual({ label: "Work" });
  });

  it.each([{ label: "" }, "archive", { mailbox: "inbox" }])(
    "rejects %j as a place",
    (mailbox) => {
      expect(() => decode({ accountIds: [ONE], mailbox })).toThrow(
        /\["mailbox"\]/u
      );
    }
  );
});
