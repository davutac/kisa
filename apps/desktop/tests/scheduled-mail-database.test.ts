import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "../../../packages/database/src/client";
import type {
  DatabaseRemoteCallback,
  RemoteDatabaseClient,
} from "../../../packages/database/src/remote-client";
import { createRemoteDatabaseClient } from "../../../packages/database/src/remote-client";
import type { withDatabaseClient } from "../src/main/database-query";
import { loadScheduledMailScopeTotals } from "../src/main/mail/scheduled-mail-database";

vi.mock(import("../src/main/database-query"), () => ({
  withDatabaseClient: (() =>
    Effect.die(
      "Database service is not used in this test"
    )) satisfies typeof withDatabaseClient,
}));

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url)
);
const temporaryDirectories: string[] = [];
const PragmaNameRows = Schema.Array(Schema.Struct({ name: Schema.String }));
const decodePragmaNames = Schema.decodeUnknownSync(PragmaNameRows);

const insertDraft = (
  connection: ReturnType<typeof openDatabaseConnection>,
  id: string
): void => {
  connection
    .prepare(
      `INSERT INTO mail_drafts (
        account_email, attachments, bcc, body_html, body_text, cc,
        created_at, id, kind, message_id, subject, thread_id, "to", updated_at
      ) VALUES ('one@example.com', '[]', '[]', '<p>Hello</p>', 'Hello', '[]',
        1, ?, 'new', NULL, 'Subject', NULL, '["to@example.com"]', 1)`
    )
    .run(id);
};

const insertScheduled = (
  connection: ReturnType<typeof openDatabaseConnection>,
  draftId: string
): void => {
  connection
    .prepare(
      `INSERT INTO scheduled_messages (
        attempt_count, created_at, draft_id, next_attempt_at, revision,
        rfc_message_id, scheduled_at, status, updated_at
      ) VALUES (0, 1, ?, 2, 1, '<schedule@example.invalid>', 2, 'scheduled', 1)`
    )
    .run(draftId);
};

const toRemoteDatabase = (
  connection: ReturnType<typeof openDatabaseConnection>
): RemoteDatabaseClient => {
  const execute: DatabaseRemoteCallback = (query, parameters, method) => {
    const statement = connection.prepare(query);
    if (method === "run") {
      statement.run(...parameters);
      return Promise.resolve({ rows: [] });
    }
    const dataStatement = statement.raw(true);
    const rows =
      method === "get"
        ? dataStatement.get(...parameters)
        : dataStatement.all(...parameters);
    return Promise.resolve({ rows: Array.isArray(rows) ? rows : [] });
  };
  return createRemoteDatabaseClient(execute);
};

describe("scheduled mail database", () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("enforces draft ownership and cascade deletion after a restart", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kisa-scheduled-mail-"));
    const databasePath = path.join(directory, "app.sqlite");
    temporaryDirectories.push(directory);
    const connection = openDatabaseConnection(databasePath);

    applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);
    expect(connection.pragma("foreign_keys", { simple: true })).toBe(1);
    insertDraft(connection, "scheduled-one");
    insertScheduled(connection, "scheduled-one");
    connection.close();

    const reopened = openDatabaseConnection(databasePath);
    try {
      expect(reopened.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(() => {
        insertScheduled(reopened, "missing-draft");
      }).toThrow(/foreign key/iu);

      reopened
        .prepare("DELETE FROM mail_drafts WHERE id = ?")
        .run("scheduled-one");
      expect(
        reopened.prepare("SELECT draft_id FROM scheduled_messages").all()
      ).toStrictEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("rejects inconsistent durable delivery states", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kisa-scheduled-state-"));
    const databasePath = path.join(directory, "app.sqlite");
    temporaryDirectories.push(directory);
    const connection = openDatabaseConnection(databasePath);

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );
      insertDraft(connection, "scheduled-invalid");

      expect(() =>
        connection
          .prepare(
            `INSERT INTO scheduled_messages (
              attempt_count, created_at, draft_id, revision, rfc_message_id,
              scheduled_at, status, updated_at
            ) VALUES (0, 1, 'scheduled-invalid', 1,
              '<schedule@example.invalid>', 2, 'scheduled', 1)`
          )
          .run()
      ).toThrow(/scheduled_messages_state_check/iu);

      expect(() =>
        connection
          .prepare(
            `INSERT INTO scheduled_messages (
              attempt_count, attention_reason, created_at, draft_id, revision,
              rfc_message_id, scheduled_at, status, updated_at
            ) VALUES (0, 'unknown-reason', 1, 'scheduled-invalid', 1,
              '<attention@example.invalid>', 2, 'attention', 1)`
          )
          .run()
      ).toThrow(/scheduled_messages_attention_reason_check/iu);
    } finally {
      connection.close();
    }
  });

  it("indexes due work in the scheduler's stable claim order", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kisa-scheduled-index-"));
    const databasePath = path.join(directory, "app.sqlite");
    temporaryDirectories.push(directory);
    const connection = openDatabaseConnection(databasePath);

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );
      const indexes = connection
        .prepare("PRAGMA index_list('scheduled_messages')")
        .all();
      const columns = connection
        .prepare("PRAGMA index_info('scheduled_messages_due_idx')")
        .all();

      expect(decodePragmaNames(indexes).map(({ name }) => name)).toContain(
        "scheduled_messages_due_idx"
      );
      expect(decodePragmaNames(columns).map(({ name }) => name)).toStrictEqual([
        "status",
        "next_attempt_at",
        "scheduled_at",
        "draft_id",
      ]);
    } finally {
      connection.close();
    }
  });

  it("reports active scheduled mail separately from its attention count", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "kisa-scheduled-count-"));
    const databasePath = path.join(directory, "app.sqlite");
    temporaryDirectories.push(directory);
    const connection = openDatabaseConnection(databasePath);

    try {
      applyDatabaseMigrations(
        createDatabaseClient(connection),
        migrationsFolder
      );
      insertDraft(connection, "scheduled-active");
      insertDraft(connection, "scheduled-attention");
      insertDraft(connection, "scheduled-sent");
      insertScheduled(connection, "scheduled-active");
      connection
        .prepare(
          `INSERT INTO scheduled_messages (
            attempt_count, attention_reason, created_at, draft_id, revision,
            rfc_message_id, scheduled_at, status, updated_at
          ) VALUES (0, 'message-invalid', 1, ?, 1,
            '<attention@example.invalid>', 2, 'attention', 1)`
        )
        .run("scheduled-attention");
      connection
        .prepare(
          `INSERT INTO scheduled_messages (
            attempt_count, created_at, draft_id, revision, rfc_message_id,
            scheduled_at, status, updated_at
          ) VALUES (1, 1, ?, 1, '<sent@example.invalid>', 2, 'sent', 1)`
        )
        .run("scheduled-sent");

      const database = toRemoteDatabase(connection);
      await expect(
        loadScheduledMailScopeTotals(database, [
          "one@example.com",
          "one@example.com",
        ])
      ).resolves.toStrictEqual({
        attentionCount: 1,
        hasScheduledMail: true,
      });

      connection
        .prepare("DELETE FROM mail_drafts WHERE id IN (?, ?)")
        .run("scheduled-active", "scheduled-attention");
      await expect(
        loadScheduledMailScopeTotals(database, ["one@example.com"])
      ).resolves.toStrictEqual({
        attentionCount: 0,
        hasScheduledMail: false,
      });
      await expect(
        loadScheduledMailScopeTotals(database, [])
      ).resolves.toStrictEqual({
        attentionCount: 0,
        hasScheduledMail: false,
      });
    } finally {
      connection.close();
    }
  });
});
