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
import { AccountId, GmailLabel, LabelColor, LabelId } from "@repo/gmail/models";
import { GmailStore } from "@repo/gmail/store";
import { Effect } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { getGoogleAccessToken } from "../src/main/auth/auth";
import type { withDatabaseClient } from "../src/main/database";
import { GmailStoreLive } from "../src/main/mail/gmail-store";

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

vi.mock(import("../src/main/auth/auth"), () => ({
  getGoogleAccessToken: vi.fn<typeof getGoogleAccessToken>(),
}));

describe("Gmail label store", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM gmail_labels").run();
  });

  afterAll(() => connection.close());

  it("persists and restores optional label colors", async () => {
    const accountId = AccountId.make("person@example.com");
    const colored = new GmailLabel({
      color: new LabelColor({ background: "#16a766", text: "#ffffff" }),
      id: LabelId.make("Label_1"),
      name: "Receipts",
      type: "user",
    });
    const uncolored = new GmailLabel({
      id: LabelId.make("INBOX"),
      name: "INBOX",
      type: "system",
    });

    const labels = await Effect.runPromise(
      Effect.gen(function* persistAndLoadLabels() {
        const store = yield* GmailStore;
        yield* store.replaceLabels(accountId, [colored, uncolored]);
        return yield* store.getLabels(accountId);
      }).pipe(Effect.provide(GmailStoreLive))
    );

    expect(labels).toHaveLength(2);
    expect(labels.find((label) => label.id === colored.id)).toStrictEqual(
      colored
    );
    expect(labels.find((label) => label.id === uncolored.id)).toStrictEqual(
      uncolored
    );
    expect(
      connection
        .prepare(
          `SELECT background_color, label_id, text_color
           FROM gmail_labels
           ORDER BY label_id`
        )
        .all()
    ).toStrictEqual([
      {
        background_color: null,
        label_id: "INBOX",
        text_color: null,
      },
      {
        background_color: "#16a766",
        label_id: "Label_1",
        text_color: "#ffffff",
      },
    ]);
  });

  it("upserts newly discovered labels without replacing the catalog", async () => {
    const accountId = AccountId.make("person@example.com");
    const inbox = new GmailLabel({
      id: LabelId.make("INBOX"),
      name: "INBOX",
      type: "system",
    });
    const updated = new GmailLabel({
      color: new LabelColor({ background: "#16a766", text: "#ffffff" }),
      id: LabelId.make("Label_1"),
      name: "Updated label",
      type: "user",
    });
    const discovered = new GmailLabel({
      color: new LabelColor({ background: "#4a86e8", text: "#ffffff" }),
      id: LabelId.make("Label_2"),
      name: "Discovered label",
      type: "user",
    });

    const labels = await Effect.runPromise(
      Effect.gen(function* upsertAndLoadLabels() {
        const store = yield* GmailStore;
        yield* store.replaceLabels(accountId, [
          inbox,
          new GmailLabel({
            id: updated.id,
            name: "Old label",
            type: "user",
          }),
        ]);
        yield* store.upsertLabels(accountId, [updated, discovered]);
        return yield* store.getLabels(accountId);
      }).pipe(Effect.provide(GmailStoreLive))
    );

    expect(
      labels.toSorted((left, right) => left.id.localeCompare(right.id))
    ).toStrictEqual([inbox, updated, discovered]);
  });
});
