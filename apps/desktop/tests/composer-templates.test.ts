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
  deleteComposerTemplate,
  listComposerTemplates,
  notifyComposerTemplatesChanged,
  saveComposerTemplate,
} from "../src/main/templates/composer-templates";
import type { ComposerTemplateChanged } from "../src/shared/ipc/templates";

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

const template = {
  accountId: "person@example.com",
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: ["copy@example.com"],
  id: "template-1",
  name: "Introduction",
  subject: "Hello",
  to: ["friend@example.com"],
};

const emittedChanges = (): ComposerTemplateChanged[] =>
  rendererEvents.send.mock.calls.map(
    (call) => call[2] as ComposerTemplateChanged
  );

describe("composer templates", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM composer_templates").run();
    connection.prepare("DELETE FROM google_accounts").run();
    connection
      .prepare(
        `INSERT INTO google_accounts (
          created_at, credentials, email, scopes, sort_order, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(1, Buffer.from([1]), "person@example.com", "[]", 1, 1);
    rendererEvents.send.mockClear();
  });

  afterAll(() => connection.close());

  it("saves, updates, lists, and deletes templates through one interface", async () => {
    const created = await Effect.runPromise(saveComposerTemplate(template));
    const updated = await Effect.runPromise(
      saveComposerTemplate({ ...template, name: "Updated introduction" })
    );

    expect(updated.createdAt).toBe(created.createdAt);
    await expect(
      Effect.runPromise(listComposerTemplates())
    ).resolves.toStrictEqual([
      expect.objectContaining({ name: "Updated introduction" }),
    ]);
    expect(emittedChanges()).toStrictEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "upsert" })])
    );

    await Effect.runPromise(
      deleteComposerTemplate({ templateId: template.id })
    );
    await expect(
      Effect.runPromise(listComposerTemplates())
    ).resolves.toStrictEqual([]);
    expect(emittedChanges().at(-1)).toStrictEqual({
      kind: "remove",
      templateId: template.id,
    });
  });

  it("keeps a template and clears its account when that account is deleted", async () => {
    await Effect.runPromise(saveComposerTemplate(template));

    connection
      .prepare("DELETE FROM google_accounts WHERE email = ?")
      .run("person@example.com");
    await Effect.runPromise(notifyComposerTemplatesChanged());

    await expect(
      Effect.runPromise(listComposerTemplates())
    ).resolves.toStrictEqual([
      expect.objectContaining({ accountId: null, id: "template-1" }),
    ]);
    expect(emittedChanges().at(-1)).toStrictEqual({
      kind: "upsert",
      template: expect.objectContaining({ accountId: null, id: "template-1" }),
    });
  });

  it("rejects a template assigned to an account that is not connected", async () => {
    await expect(
      Effect.runPromise(
        saveComposerTemplate({ ...template, accountId: "missing@example.com" })
      )
    ).rejects.toMatchObject({ message: "Could not save template" });
  });

  it("rejects duplicate names without regard to case", async () => {
    await Effect.runPromise(saveComposerTemplate(template));

    await expect(
      Effect.runPromise(
        saveComposerTemplate({
          ...template,
          id: "template-2",
          name: "introduction",
        })
      )
    ).rejects.toMatchObject({ message: "Could not save template" });
  });

  it("rejects unknown variables at the persisted interface", async () => {
    await expect(
      Effect.runPromise(
        saveComposerTemplate({ ...template, subject: "Hello {{dat}}" })
      )
    ).rejects.toMatchObject({ message: "Unknown template variable: dat" });
  });
});
