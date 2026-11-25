import { Schema } from "effect";
import { beforeEach, describe, expect, it } from "vitest";

import {
  readThreadPage,
  threadPlaces,
} from "../src/main/mail/engine/mail-reads";
import { MailCachedThreadPageRequest } from "../src/shared/ipc/mail";
import type { MailboxPlace } from "../src/shared/ipc/mail";
import { mailboxPlaceKey } from "../src/shared/mailbox-places";
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

/** Every row a place's pages list, with the places sent for each. */
const pagesOf = async (mailbox: MailboxPlace) => {
  const rows: { readonly places: readonly string[]; readonly id: string }[] =
    [];

  let cursor: MailCachedThreadPageRequest["cursor"];

  for (let page = 0; page < 20; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- One page after another.
    const { nextCursor, threads } = await readThreadPage(remoteDatabase, {
      accountIds: [ONE],
      cursor,
      mailbox,
    });

    rows.push(
      ...threads.map(({ places, threadId }) => ({ id: threadId, places }))
    );

    if (nextCursor === undefined) {
      return rows;
    }

    cursor = nextCursor;
  }

  throw new Error("the pages did not end");
};

// The page query states in SQL the rule `listingPlaces` states once in
// TypeScript, whose answer goes out with every conversation as `places`. A
// window lists a live update by those places, so the two have to agree on
// every row, or a row would sit in one list after a page and another after
// an event.
describe("where a conversation is listed", () => {
  beforeEach(() => {
    resetDatabase();
  });

  /** What a row can carry besides where its mail is. */
  const LABEL_SETS: readonly (readonly string[])[] = [
    [],
    ["STARRED"],
    ["u:Work"],
    ["u:work", "STARRED"],
    ["u:WORK/Clients"],
    ["u:Ärzte"],
    ["u:ärzte"],
    // Folders a server names like a mailbox, and a star's name as a label.
    ["u:TRASH"],
    ["u:Inbox"],
    ["u:STARRED"],
  ];

  const PLACES: readonly MailboxPlace[] = [
    "inbox",
    "sent",
    "spam",
    "starred",
    "trash",
    { label: "Work" },
    { label: "work/clients" },
    { label: "Ärzte" },
    { label: "ärzte" },
    { label: "Trash" },
    { label: "INBOX" },
    { label: "Starred" },
  ];

  /** Every way a row's four projections can be set, with each label set. */
  const everyRow = () =>
    Array.from({ length: 16 }, (_, flags) => flags).flatMap((flags) =>
      LABEL_SETS.map((labelIds, index) => ({
        isInInbox: flags % 2 === 1,
        isInSent: Math.floor(flags / 2) % 2 === 1,
        isInSpam: Math.floor(flags / 4) % 2 === 1,
        isInTrash: Math.floor(flags / 8) % 2 === 1,
        labelIds,
        threadId: `row-${flags}-${index}`,
      }))
    );

  const insertRow = (row: ReturnType<typeof everyRow>[number]): void => {
    connection
      .prepare(
        `INSERT INTO mail_threads (account_id, attachments, from_address,
          has_attachments, is_in_inbox, is_in_sent, is_in_spam, is_in_trash,
          is_unread, label_ids, latest_at, latest_message_id, message_count,
          snippet, subject, thread_id, updated_at)
         VALUES (?, '[]', 'sender@example.com', 0, ?, ?, ?, ?, 0, ?, 1000, 'm',
          1, '', 'Subject', ?, 0)`
      )
      .run(
        ONE,
        Number(row.isInInbox),
        Number(row.isInSent),
        Number(row.isInSpam),
        Number(row.isInTrash),
        JSON.stringify(row.labelIds),
        row.threadId
      );
  };

  it("is listed by the page query in exactly the places sent with it", async () => {
    const rows = everyRow();

    for (const row of rows) {
      insertRow(row);
    }

    const differences: string[] = [];

    for (const place of PLACES) {
      const key = mailboxPlaceKey(place);
      // oxlint-disable-next-line eslint/no-await-in-loop -- One place after another.
      const paged = await pagesOf(place);

      const byRule = rows
        .filter((row) => threadPlaces(row).includes(key))
        .map((row) => row.threadId);

      if (
        paged
          .map((row) => row.id)
          .toSorted()
          .join(" ") !== byRule.toSorted().join(" ")
      ) {
        differences.push(`${key}: the page and the rule list different rows`);
      }

      differences.push(
        ...paged
          .filter((row) => !row.places.includes(key))
          .map((row) => `${key}: ${row.id} was sent without it`)
      );
    }

    expect(differences).toStrictEqual([]);
    // Every place lists something, so none agrees by listing nothing.
    expect(
      PLACES.filter(
        (place) =>
          !rows.some((row) =>
            threadPlaces(row).includes(mailboxPlaceKey(place))
          )
      )
    ).toStrictEqual([]);
  });

  it("folds a label's case as the page query does, in ASCII only", () => {
    expect({
      capitals: mailboxPlaceKey({ label: "WORK/Clients" }),
      folder: mailboxPlaceKey({ label: "Trash" }),
      mailbox: mailboxPlaceKey("trash"),
      umlaut: mailboxPlaceKey({ label: "Ärzte" }),
    }).toStrictEqual({
      capitals: "label:work/clients",
      folder: "label:trash",
      mailbox: "trash",
      umlaut: "label:Ärzte",
    });
  });
});
