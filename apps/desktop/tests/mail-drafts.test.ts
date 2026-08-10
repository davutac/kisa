// oxlint-disable typescript/no-unsafe-type-assertion
import { fileURLToPath } from "node:url";

import {
  applyDatabaseMigrations,
  createDatabaseClient,
  openDatabaseConnection,
} from "@repo/database/client";
import type {
  DatabaseRemoteCallback,
  RemoteDatabaseClient,
} from "@repo/database/remote-client";
import { createRemoteDatabaseClient } from "@repo/database/remote-client";
import { Effect } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { withDatabaseClient } from "../src/main/database";
import {
  discardMailDraft,
  listStashedDrafts,
  loadThreadDraft,
  saveMailDraft,
} from "../src/main/mail/mail-drafts";
import type { MailDraftChanged } from "../src/shared/ipc/mail";

const rendererEvents = vi.hoisted(() => ({
  send: vi.fn<(...arguments_: unknown[]) => void>(),
}));

const connection = openDatabaseConnection(":memory:");
applyDatabaseMigrations(
  createDatabaseClient(connection),
  fileURLToPath(new URL("../../../packages/database/drizzle", import.meta.url))
);

const executeRemoteQuery: DatabaseRemoteCallback = (
  query,
  parameters,
  method
) => {
  const statement = connection.prepare(query);

  if (method === "run") {
    statement.run(...parameters);
    return Promise.resolve({ rows: [] });
  }

  const dataStatement = statement.raw(true);
  if (method === "get") {
    const row = dataStatement.get(...parameters);
    return Promise.resolve({ rows: row as never[] });
  }

  return Promise.resolve({ rows: dataStatement.all(...parameters) });
};

const remoteDatabase = createRemoteDatabaseClient(executeRemoteQuery);

vi.mock(import("../src/main/database"), async () => {
  const { DatabaseError } = await import("@repo/database/runtime");
  const { Effect: EffectModule } = await import("effect");
  const useTestDatabase = (<A>(
    run: (database: RemoteDatabaseClient) => Promise<A>
  ) =>
    EffectModule.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "query" }),
      try: () => run(remoteDatabase),
    })) as typeof withDatabaseClient;

  return { withDatabaseClient: useTestDatabase };
});

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: rendererEvents.send,
}));

connection
  .prepare(
    `INSERT INTO google_accounts (
      created_at, credentials, email, scopes, sort_order, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`
  )
  .run(1, Buffer.from([1]), "person@example.com", "[]", 1, 1);

const newDraft = {
  attachments: [],
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  id: "new-draft",
  kind: "new" as const,
  subject: "Hello",
  to: ["friend@example.com"],
};

const replyDraft = {
  accountId: "person@example.com",
  attachments: [],
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  id: "reply-draft",
  kind: "reply" as const,
  messageId: "message-1",
  subject: "",
  threadId: "thread-1",
  to: ["friend@example.com"],
};

const emittedChanges = (): MailDraftChanged[] =>
  rendererEvents.send.mock.calls.map((call) => call[2] as MailDraftChanged);

describe("mail drafts", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM mail_drafts").run();
    rendererEvents.send.mockClear();
  });

  afterAll(() => connection.close());

  it("stores and lists assigned and unassigned new-email stashes", async () => {
    const unassigned = await Effect.runPromise(saveMailDraft(newDraft));
    const assigned = await Effect.runPromise(
      saveMailDraft({
        ...newDraft,
        accountId: "person@example.com",
        id: "assigned-draft",
      })
    );

    expect(unassigned).not.toHaveProperty("accountId");
    expect(assigned.accountId).toBe("person@example.com");
    await expect(
      Effect.runPromise(listStashedDrafts({ accountIds: [] }))
    ).resolves.toMatchObject([{ id: "new-draft" }]);
    await expect(
      Effect.runPromise(
        listStashedDrafts({ accountIds: ["person@example.com"] })
      )
    ).resolves.toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "new-draft" }),
        expect.objectContaining({ id: "assigned-draft" }),
      ])
    );
  });

  it("rejects invalid draft ownership and conversation context", async () => {
    await expect(
      Effect.runPromise(
        saveMailDraft({
          ...newDraft,
          accountId: "missing@example.com",
        })
      )
    ).rejects.toMatchObject({ message: "Could not save draft" });
    await expect(
      Effect.runPromise(
        saveMailDraft({
          ...newDraft,
          messageId: "message-1",
          threadId: "thread-1",
        })
      )
    ).rejects.toMatchObject({ message: "Could not save draft" });
  });

  it("replaces, loads, and account-scopes a conversation draft", async () => {
    await Effect.runPromise(saveMailDraft(replyDraft));
    await Effect.runPromise(
      saveMailDraft({ ...replyDraft, id: "replacement-draft", kind: "forward" })
    );

    await expect(
      Effect.runPromise(loadThreadDraft("person@example.com", "thread-1"))
    ).resolves.toMatchObject({ id: "replacement-draft", kind: "forward" });
    expect(emittedChanges()).toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ draftId: "reply-draft", kind: "remove" }),
      ])
    );

    await Effect.runPromise(
      discardMailDraft({
        accountId: "someone@example.com",
        draftId: "replacement-draft",
      })
    );
    await expect(
      Effect.runPromise(loadThreadDraft("person@example.com", "thread-1"))
    ).resolves.toMatchObject({ id: "replacement-draft" });

    await Effect.runPromise(
      discardMailDraft({
        accountId: "person@example.com",
        draftId: "replacement-draft",
      })
    );
    await expect(
      Effect.runPromise(loadThreadDraft("person@example.com", "thread-1"))
    ).resolves.toBeNull();
  });
});
