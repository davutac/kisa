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
import { updateAccountSettings } from "../src/main/settings/account-settings";

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
    return Promise.resolve({
      rows: dataStatement.get(...parameters) as never[],
    });
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

describe("account settings", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM account_settings").run();
    rendererEvents.send.mockClear();
  });

  afterAll(() => connection.close());

  it("stores and returns rich signatures with their plain-text alternative", async () => {
    const emailSignature = {
      html: '<p><strong>Best,</strong><br><a href="https://example.com">Davut</a></p>',
      text: "Best,\nDavut",
    };

    await expect(
      Effect.runPromise(
        updateAccountSettings({
          accountId: "person@example.com",
          emailSignature,
        })
      )
    ).resolves.toMatchObject([{ emailSignature }]);

    const stored = connection
      .prepare("SELECT email_signature AS emailSignature FROM account_settings")
      .get() as { emailSignature: string };
    expect(JSON.parse(stored.emailSignature)).toStrictEqual(emailSignature);
    expect(rendererEvents.send).toHaveBeenCalledOnce();
  });

  it("uses an empty signature when another setting creates the row", async () => {
    await expect(
      Effect.runPromise(
        updateAccountSettings({
          accountId: "person@example.com",
          notificationsEnabled: false,
        })
      )
    ).resolves.toMatchObject([
      {
        emailSignature: { html: "", text: "" },
        notificationsEnabled: false,
      },
    ]);
  });
});
