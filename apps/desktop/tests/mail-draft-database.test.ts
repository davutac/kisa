import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "../../../packages/database/src/client";

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url)
);
const temporaryDirectories: string[] = [];

const insertDraft = (
  connection: ReturnType<typeof openDatabaseConnection>,
  input: {
    accountId?: string;
    id: string;
    kind: "new" | "reply";
    threadId?: string;
    updatedAt: number;
  }
): void => {
  connection
    .prepare(
      `INSERT INTO mail_drafts (
        account_email, attachments, bcc, body_html, body_text, cc,
        created_at, id, kind, message_id, subject, thread_id, "to", updated_at
      ) VALUES (?, '[]', '[]', '', '', '[]', ?, ?, ?, NULL, '', ?, '[]', ?)`
    )
    .run(
      input.accountId ?? null,
      input.updatedAt,
      input.id,
      input.kind,
      input.threadId ?? null,
      input.updatedAt
    );
};

describe("mail draft database", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("persists drafts across restart and isolates equal thread IDs by account", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kisa-drafts-"));
    const databasePath = path.join(directory, "app.sqlite");
    temporaryDirectories.push(directory);
    const connection = openDatabaseConnection(databasePath);

    applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);
    insertDraft(connection, {
      accountId: "one@example.com",
      id: "reply-one",
      kind: "reply",
      threadId: "shared-thread",
      updatedAt: 1,
    });
    insertDraft(connection, {
      accountId: "two@example.com",
      id: "reply-two",
      kind: "reply",
      threadId: "shared-thread",
      updatedAt: 2,
    });
    insertDraft(connection, {
      accountId: "one@example.com",
      id: "new-one",
      kind: "new",
      updatedAt: 3,
    });
    insertDraft(connection, {
      accountId: "one@example.com",
      id: "new-two",
      kind: "new",
      updatedAt: 4,
    });
    insertDraft(connection, {
      id: "new-unassigned",
      kind: "new",
      updatedAt: 5,
    });
    connection.close();

    const reopened = openDatabaseConnection(databasePath);
    try {
      expect(
        reopened
          .prepare(
            "SELECT account_email, id, thread_id FROM mail_drafts ORDER BY updated_at"
          )
          .all()
      ).toStrictEqual([
        {
          account_email: "one@example.com",
          id: "reply-one",
          thread_id: "shared-thread",
        },
        {
          account_email: "two@example.com",
          id: "reply-two",
          thread_id: "shared-thread",
        },
        { account_email: "one@example.com", id: "new-one", thread_id: null },
        { account_email: "one@example.com", id: "new-two", thread_id: null },
        { account_email: null, id: "new-unassigned", thread_id: null },
      ]);
      expect(() =>
        insertDraft(reopened, {
          accountId: "one@example.com",
          id: "duplicate-reply",
          kind: "reply",
          threadId: "shared-thread",
          updatedAt: 6,
        })
      ).toThrow(/unique/iu);
    } finally {
      reopened.close();
    }
  });
});
