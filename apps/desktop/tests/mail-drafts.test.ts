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
import { Effect, Option, Schema } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { cancelHeldSend, holdSend } from "../src/main/mail/held-sends";
import {
  discardMailDraft,
  listStashedDrafts,
  loadThreadDraft,
  republishDraft,
  saveMailDraft,
} from "../src/main/mail/mail-drafts";
import { outgoingAttachmentAuthorizations } from "../src/main/mail/outgoing-attachment-authorizations";
import { MailDraftChanged } from "../src/shared/ipc/mail";
import { insertGmailAccount } from "./fixtures/mail-accounts";

// SAFETY: each assertion in this object only widens an empty starting value,
// `[]` or `undefined`, to the type the tests fill it with.
const rendererEvents = vi.hoisted(() => ({
  owners: [
    {
      id: 7,
      once: vi.fn<(event: "destroyed", listener: () => void) => void>(),
    },
    {
      id: 8,
      once: vi.fn<(event: "destroyed", listener: () => void) => void>(),
    },
  ],
  payloads: [] as unknown[],
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

    return Promise.resolve({ rows: Array.isArray(row) ? row : [] });
  }

  return Promise.resolve({ rows: dataStatement.all(...parameters) });
};

const remoteDatabase = createRemoteDatabaseClient(executeRemoteQuery);

vi.mock(import("../src/main/database-query"), async () => {
  const { DatabaseError } = await import("@repo/database/runtime");
  const { Effect: EffectModule } = await import("effect");

  const useTestDatabase = <A>(
    run: (database: RemoteDatabaseClient) => Promise<A>
  ) =>
    EffectModule.tryPromise({
      catch: (cause) => DatabaseError.new({ cause, reason: "query" }),
      try: () => run(remoteDatabase),
    });

  return { withDatabaseClient: useTestDatabase };
});

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: (_channel, _schema, payload) => {
    rendererEvents.payloads.push(payload);
  },
  sendRendererEventToEachWindow: (_channel, _schema, makePayload) => {
    for (const owner of rendererEvents.owners) {
      rendererEvents.payloads.push(makePayload(owner));
    }
  },
}));

insertGmailAccount(connection, "person@example.com");

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

const decodeMailDraftChanged = Schema.decodeUnknownOption(MailDraftChanged);

const emittedChanges = (): MailDraftChanged[] =>
  rendererEvents.payloads.flatMap((payload) =>
    Option.match(decodeMailDraftChanged(payload), {
      onNone: () => [],
      onSome: (change) => [change],
    })
  );

describe("mail drafts", () => {
  beforeEach(() => {
    connection.prepare("DELETE FROM mail_drafts").run();
    rendererEvents.payloads.length = 0;
  });

  afterAll(() => connection.close());

  it("stores and lists assigned and unassigned new-email stashes", async () => {
    const unassigned = await Effect.runPromise(saveMailDraft(newDraft, 7));

    const assigned = await Effect.runPromise(
      saveMailDraft(
        {
          ...newDraft,
          accountId: "person@example.com",
          id: "assigned-draft",
        },
        7
      )
    );

    expect(unassigned).not.toHaveProperty("accountId");
    expect(assigned.accountId).toBe("person@example.com");
    await expect(
      Effect.runPromise(listStashedDrafts({ accountIds: [] }, 7))
    ).resolves.toMatchObject([{ id: "new-draft" }]);
    await expect(
      Effect.runPromise(
        listStashedDrafts({ accountIds: ["person@example.com"] }, 7)
      )
    ).resolves.toStrictEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "new-draft" }),
        expect.objectContaining({ id: "assigned-draft" }),
      ])
    );
  });

  it("keeps a draft out of sight and untouched while its message is held for Undo", async () => {
    const accountId = "person@example.com";
    await Effect.runPromise(saveMailDraft({ ...newDraft, accountId }, 7));
    await Effect.runPromise(saveMailDraft(replyDraft, 7));

    const drafts = ["new-draft", "reply-draft"].map((draftId) => ({
      accountId,
      draftId,
    }));

    for (const draft of drafts) {
      Effect.runFork(holdSend(draft, 7, 60_000, Effect.void));
    }

    const look = Effect.gen(function* lookAtDrafts() {
      const listed = yield* listStashedDrafts({ accountIds: [accountId] }, 7);
      const reply = yield* loadThreadDraft(accountId, "thread-1", 7);

      return { listed: listed.map((draft) => draft.id), reply: reply?.id };
    });

    const whileHeld = await Effect.runPromise(
      Effect.gen(function* touchHeldDrafts() {
        const discard = yield* Effect.flip(
          discardMailDraft({ accountId, draftId: "new-draft" })
        );

        const save = yield* Effect.flip(
          saveMailDraft({ ...replyDraft, subject: "Edited" }, 7)
        );

        const seen = yield* look;

        return { ...seen, discard: discard.message, save: save.message };
      })
    );

    await Effect.runPromise(
      Effect.forEach(drafts, (draft) => cancelHeldSend(draft, 7), {
        discard: true,
      })
    );
    rendererEvents.payloads.length = 0;
    await Effect.runPromise(republishDraft(accountId, "reply-draft"));
    const afterwards = await Effect.runPromise(look);

    expect({
      afterwards,
      republished: emittedChanges().map((change) =>
        change.kind === "upsert" ? change.draft.id : change.kind
      ),
      whileHeld,
    }).toStrictEqual({
      afterwards: { listed: ["new-draft"], reply: "reply-draft" },
      // Once for each window.
      republished: ["reply-draft", "reply-draft"],
      whileHeld: {
        discard: "This message is being sent; undo it to make changes",
        listed: [],
        reply: undefined,
        save: "This message is being sent; undo it to make changes",
      },
    });
  });

  it("persists the automatic signature metadata with its editable body", async () => {
    const signature = {
      accountId: "person@example.com",
      body: { html: "<p>Best,<br>Davut</p>", text: "Best,\nDavut" },
    };

    await Effect.runPromise(
      saveMailDraft(
        {
          ...newDraft,
          accountId: "person@example.com",
          body: {
            html: `<p>Hello</p><p></p>${signature.body.html}`,
            text: `Hello\n\n${signature.body.text}`,
          },
          signature,
        },
        7
      )
    );

    await expect(
      Effect.runPromise(
        listStashedDrafts({ accountIds: ["person@example.com"] }, 7)
      )
    ).resolves.toMatchObject([
      {
        body: {
          html: "<p>Hello</p><p></p><p>Best,<br>Davut</p>",
          text: "Hello\n\nBest,\nDavut",
        },
        signature,
      },
    ]);
  });

  it("rejects invalid draft ownership and conversation context", async () => {
    await expect(
      Effect.runPromise(
        saveMailDraft(
          {
            ...newDraft,
            accountId: "missing@example.com",
          },
          7
        )
      )
    ).rejects.toMatchObject({ message: "Could not save draft" });
    await expect(
      Effect.runPromise(
        saveMailDraft(
          {
            ...newDraft,
            messageId: "message-1",
            threadId: "thread-1",
          },
          7
        )
      )
    ).rejects.toMatchObject({ message: "Could not save draft" });
    await expect(
      Effect.runPromise(
        saveMailDraft(
          {
            ...newDraft,
            accountId: "person@example.com",
            body: {
              html: "<p>Hello</p><p>Signature</p>",
              text: "Hello\n\nSignature",
            },
            signature: {
              accountId: "other@example.com",
              body: { html: "<p>Signature</p>", text: "Signature" },
            },
          },
          7
        )
      )
    ).rejects.toMatchObject({ message: "Could not save draft" });
  });

  it("does not let ordinary draft mutations bypass scheduled-mail rules", async () => {
    const scheduledDraft = {
      ...newDraft,
      accountId: "person@example.com",
      id: "scheduled-draft",
    };

    await Effect.runPromise(saveMailDraft(scheduledDraft, 7));
    connection
      .prepare(
        `INSERT INTO scheduled_messages (
          attempt_count, created_at, draft_id, next_attempt_at, revision,
          rfc_message_id, scheduled_at, status, updated_at
        ) VALUES (0, 1, ?, 2, 1, '<stable@scheduled.kisa.invalid>', 2,
          'scheduled', 1)`
      )
      .run(scheduledDraft.id);

    await expect(
      Effect.runPromise(
        saveMailDraft({ ...scheduledDraft, subject: "Bypass" }, 7)
      )
    ).rejects.toMatchObject({ message: "Could not save draft" });
    await expect(
      Effect.runPromise(
        discardMailDraft({
          accountId: scheduledDraft.accountId,
          draftId: scheduledDraft.id,
        })
      )
    ).rejects.toMatchObject({ message: "Could not discard draft" });
    expect(
      connection
        .prepare("SELECT subject FROM mail_drafts WHERE id = ?")
        .get(scheduledDraft.id)
    ).toMatchObject({ subject: "Hello" });
  });

  it("broadcasts attachment references scoped to each window", async () => {
    const [attachment] =
      outgoingAttachmentAuthorizations.restoreDraftAttachments(7, [
        {
          authorizationVersion: 1,
          birthtimeMs: 1,
          device: "1",
          filename: "notes.txt",
          id: "attachment-1",
          inode: "1",
          mediaType: "text/plain",
          mtimeMs: 1,
          path: "/validated/notes.txt",
          size: 5,
        },
      ]);

    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }

    await Effect.runPromise(
      saveMailDraft({ ...newDraft, attachments: [attachment] }, 7)
    );

    const upserts = emittedChanges().filter(
      (change) => change.kind === "upsert"
    );

    expect(upserts).toHaveLength(2);
    const [sourceUpsert, otherWindowUpsert] = upserts;

    if (
      sourceUpsert?.kind !== "upsert" ||
      otherWindowUpsert?.kind !== "upsert"
    ) {
      throw new Error("Expected one attachment upsert per window");
    }

    const [sourceAttachment] = sourceUpsert.draft.attachments;
    const [otherWindowAttachment] = otherWindowUpsert.draft.attachments;

    if (sourceAttachment === undefined || otherWindowAttachment === undefined) {
      throw new Error("Expected each upsert to include the attachment");
    }

    expect(sourceAttachment.referenceId).not.toBe(
      otherWindowAttachment.referenceId
    );
    expect(() =>
      outgoingAttachmentAuthorizations.serializeDraftAttachments(8, [
        sourceAttachment,
      ])
    ).toThrow("no longer authorized");
    expect(
      outgoingAttachmentAuthorizations.serializeDraftAttachments(8, [
        otherWindowAttachment,
      ])
    ).toHaveLength(1);

    await Promise.all([
      outgoingAttachmentAuthorizations.releaseOwner(7),
      outgoingAttachmentAuthorizations.releaseOwner(8),
    ]);
  });

  it("replaces, loads, and account-scopes a conversation draft", async () => {
    await Effect.runPromise(saveMailDraft(replyDraft, 7));
    await Effect.runPromise(
      saveMailDraft(
        { ...replyDraft, id: "replacement-draft", kind: "forward" },
        7
      )
    );

    await expect(
      Effect.runPromise(loadThreadDraft("person@example.com", "thread-1", 7))
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
      Effect.runPromise(loadThreadDraft("person@example.com", "thread-1", 7))
    ).resolves.toMatchObject({ id: "replacement-draft" });

    await Effect.runPromise(
      discardMailDraft({
        accountId: "person@example.com",
        draftId: "replacement-draft",
      })
    );
    await expect(
      Effect.runPromise(loadThreadDraft("person@example.com", "thread-1", 7))
    ).resolves.toBeNull();
  });
});
