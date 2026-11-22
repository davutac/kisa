import { beforeEach, describe, expect, it } from "vitest";

import { readUnreadLabels } from "../src/main/mail/engine/mail-reads";
import {
  hasUnreadLabel,
  toUnreadLabelKey,
  toUnreadLabelKeys,
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

const readKeys = async (
  accountIds: readonly string[] = [ONE, TWO]
): Promise<readonly string[]> =>
  [
    ...toUnreadLabelKeys(await readUnreadLabels(remoteDatabase, accountIds)),
  ].toSorted();

describe("unread labels", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("lists a label with an unread conversation, in or out of the Inbox", async () => {
    insertThread(ONE, ["INBOX", "u:Work"], true);
    insertThread(ONE, ["u:Archive"], true);
    insertThread(ONE, ["INBOX", "u:Read"], false);

    await expect(readKeys()).resolves.toStrictEqual([
      toUnreadLabelKey(ONE, "Archive"),
      toUnreadLabelKey(ONE, "Work"),
    ]);
  });

  it("leaves out unread mail in Spam and Trash, as the label place does", async () => {
    insertThread(ONE, ["SPAM", "u:Work"], true);
    insertThread(ONE, ["TRASH", "u:Work"], true);

    await expect(readKeys()).resolves.toStrictEqual([]);
  });

  it("lists user labels only, each nested path on its own", async () => {
    insertThread(ONE, ["INBOX", "IMPORTANT", "UNREAD", "u:Bills/Steuer"], true);

    await expect(readKeys()).resolves.toStrictEqual([
      toUnreadLabelKey(ONE, "Bills/Steuer"),
    ]);
  });

  it("folds case as the catalog does, beyond ASCII", async () => {
    insertThread(ONE, ["u:Prüfung"], true);

    const keys = await readKeys();

    expect(keys).toStrictEqual([toUnreadLabelKey(ONE, "PRÜFUNG")]);
  });

  it("keeps each account's labels apart, and reads only the accounts asked", async () => {
    insertThread(ONE, ["u:Shared"], true);
    insertThread(TWO, ["u:Shared"], false);
    insertThread(TWO, ["u:Other"], true);

    await expect(readKeys()).resolves.toStrictEqual(
      [
        toUnreadLabelKey(ONE, "Shared"),
        toUnreadLabelKey(TWO, "Other"),
      ].toSorted()
    );
    await expect(readKeys([TWO])).resolves.toStrictEqual([
      toUnreadLabelKey(TWO, "Other"),
    ]);
    await expect(readKeys([])).resolves.toStrictEqual([]);
  });
});

describe("the collapsed Labels row", () => {
  it("is unread when any of its account's own labels is", () => {
    const unread = new Set([toUnreadLabelKey(ONE, "Bills/Steuer")]);

    expect(
      hasUnreadLabel(unread, ONE, [
        { name: "Amazon" },
        { name: "bills/steuer" },
      ])
    ).toBeTruthy();
    expect(hasUnreadLabel(unread, ONE, [{ name: "Amazon" }])).toBeFalsy();
    // Another account's unread label of the same name does not count.
    expect(hasUnreadLabel(unread, TWO, [{ name: "Bills/Steuer" }])).toBeFalsy();
  });
});
