import { beforeEach, describe, expect, it } from "vitest";

import {
  readUnreadCounts,
  readUnreadLabels,
} from "../src/main/mail/engine/mail-reads";
import {
  toUnreadLabelCounts,
  toUnreadLabelKey,
} from "../src/renderer/src/mail/use-unread-labels";
import {
  connection,
  remoteDatabase,
  resetDatabase,
} from "./fixtures/mail-engine-harness";

const ONE = "one@example.com";
const TWO = "two@example.com";

let nextThread = 0;

const insertThread = (
  accountId: string,
  labelIds: readonly string[],
  isUnread: boolean
): void => {
  nextThread += 1;
  connection
    .prepare(
      `INSERT INTO mail_threads (account_id, attachments, from_address,
        has_attachments, is_in_inbox, is_in_sent, is_in_spam, is_in_trash,
        is_unread, label_ids, latest_at, latest_message_id, message_count,
        snippet, subject, thread_id, updated_at)
       VALUES (?, '[]', 'sender@example.com', 0, ?, 0, ?, ?, ?, ?, 1000, 'm',
        1, '', 'Subject', ?, 0)`
    )
    .run(
      accountId,
      Number(labelIds.includes("INBOX")),
      Number(labelIds.includes("SPAM")),
      Number(labelIds.includes("TRASH")),
      Number(isUnread),
      JSON.stringify(labelIds),
      `thread-${nextThread}`
    );
};

const readCounts = async (accountIds: readonly string[] = [ONE, TWO]) =>
  toUnreadLabelCounts(await readUnreadLabels(remoteDatabase, accountIds));

const readLabels = async (
  accountIds?: readonly string[]
): Promise<Record<string, number>> => {
  const { labels } = await readCounts(accountIds);
  return Object.fromEntries(labels);
};

describe("unread labels", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("counts a label's unread conversations, in or out of the Inbox", async () => {
    insertThread(ONE, ["INBOX", "u:Work"], true);
    insertThread(ONE, ["u:Work"], true);
    insertThread(ONE, ["u:Archive"], true);
    insertThread(ONE, ["INBOX", "u:Read"], false);

    await expect(readLabels()).resolves.toStrictEqual({
      [toUnreadLabelKey(ONE, "Archive")]: 1,
      [toUnreadLabelKey(ONE, "Work")]: 2,
    });
  });

  it("leaves out unread mail in Spam and Trash, as the label place does", async () => {
    insertThread(ONE, ["SPAM", "u:Work"], true);
    insertThread(ONE, ["TRASH", "u:Work"], true);

    const counts = await readCounts();

    expect(Object.fromEntries(counts.labels)).toStrictEqual({});
    expect(Object.fromEntries(counts.accounts)).toStrictEqual({});
  });

  it("counts user labels only, each nested path on its own", async () => {
    insertThread(ONE, ["INBOX", "IMPORTANT", "UNREAD", "u:Bills/Steuer"], true);

    await expect(readLabels()).resolves.toStrictEqual({
      [toUnreadLabelKey(ONE, "Bills/Steuer")]: 1,
    });
  });

  it("folds case as the catalog does, beyond ASCII, adding up what folds together", async () => {
    insertThread(ONE, ["u:Prüfung"], true);
    insertThread(ONE, ["u:PRÜFUNG"], true);

    await expect(readLabels()).resolves.toStrictEqual({
      [toUnreadLabelKey(ONE, "prüfung")]: 2,
    });
  });

  it("keeps each account's labels apart, and reads only the accounts asked", async () => {
    insertThread(ONE, ["u:Shared"], true);
    insertThread(TWO, ["u:Shared"], false);
    insertThread(TWO, ["u:Other"], true);

    await expect(readLabels()).resolves.toStrictEqual({
      [toUnreadLabelKey(ONE, "Shared")]: 1,
      [toUnreadLabelKey(TWO, "Other")]: 1,
    });
    await expect(readLabels([TWO])).resolves.toStrictEqual({
      [toUnreadLabelKey(TWO, "Other")]: 1,
    });
    await expect(readLabels([])).resolves.toStrictEqual({});
  });

  it("counts a conversation once per account for the collapsed Labels row", async () => {
    insertThread(ONE, ["INBOX", "u:Work", "u:Bills"], true);
    insertThread(ONE, ["u:Work"], true);
    insertThread(ONE, ["INBOX"], true);
    insertThread(TWO, ["u:Work"], true);

    const counts = await readCounts();

    expect(counts.labels.get(toUnreadLabelKey(ONE, "Work"))).toBe(2);
    expect(counts.labels.get(toUnreadLabelKey(ONE, "Bills"))).toBe(1);
    expect(Object.fromEntries(counts.accounts)).toStrictEqual({
      [ONE]: 2,
      [TWO]: 1,
    });
  });
});

describe("unread counts", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("counts unread Inbox conversations as the Unread filter lists them", async () => {
    insertThread(ONE, ["INBOX"], true);
    insertThread(ONE, ["INBOX"], true);
    insertThread(ONE, ["INBOX"], false);
    insertThread(ONE, ["u:Archive"], true);
    insertThread(ONE, ["INBOX", "TRASH"], true);

    await expect(
      readUnreadCounts(remoteDatabase, [ONE])
    ).resolves.toStrictEqual({ inbox: 2, spam: 0 });
  });

  it("counts unread Spam on its own", async () => {
    insertThread(ONE, ["SPAM"], true);
    insertThread(ONE, ["SPAM"], false);
    insertThread(ONE, ["INBOX", "SPAM"], true);

    await expect(
      readUnreadCounts(remoteDatabase, [ONE])
    ).resolves.toStrictEqual({ inbox: 0, spam: 2 });
  });

  it("counts only the accounts asked, together for a combined scope", async () => {
    insertThread(ONE, ["INBOX"], true);
    insertThread(TWO, ["INBOX"], true);
    insertThread(TWO, ["SPAM"], true);

    await expect(
      readUnreadCounts(remoteDatabase, [ONE])
    ).resolves.toStrictEqual({ inbox: 1, spam: 0 });
    await expect(
      readUnreadCounts(remoteDatabase, [ONE, TWO])
    ).resolves.toStrictEqual({ inbox: 2, spam: 1 });
    await expect(readUnreadCounts(remoteDatabase, [])).resolves.toStrictEqual({
      inbox: 0,
      spam: 0,
    });
  });
});
