import { access, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  findSentMessage,
  sendNewMessage,
} from "../src/main/mail/engine/mail-send";
import { decodeStoredOutgoingAttachmentsStrict } from "../src/main/mail/outgoing-attachment-files";
import type {
  closeScheduledMailNotifications,
  dispatchPendingScheduledMailNotifications,
  releaseStaleScheduledMailNotificationClaims,
  showScheduledMailNotification,
} from "../src/main/mail/scheduled-mail-notifications";
import type { ScheduledMailEditSession } from "../src/shared/ipc/scheduled-mail";
import { insertGmailAccount } from "./fixtures/mail-accounts";

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

vi.mock(import("electron"), async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    net: { ...original.net, isOnline: () => true },
    powerMonitor: {
      ...original.powerMonitor,
      off: () => original.powerMonitor,
      on: () => original.powerMonitor,
    },
  };
});

vi.mock(import("../src/main/electron/renderer-events"), () => ({
  sendRendererEvent: vi.fn<() => void>(),
  sendRendererEventToEachWindow: vi.fn<() => void>(),
}));

vi.mock(import("../src/main/mail/engine/mail-engine"), async () => {
  const { Effect: EffectModule } = await import("effect");
  return {
    runEngineExit: (
      effect: Parameters<typeof EffectModule.runPromiseExit>[0]
    ) => EffectModule.runPromiseExit(effect),
  } as never;
});

vi.mock(import("../src/main/mail/engine/mail-send"), () => ({
  findSentMessage: vi.fn<typeof findSentMessage>(),
  sendNewMessage: vi.fn<typeof sendNewMessage>(),
}));

vi.mock(import("../src/main/mail/scheduled-mail-notifications"), () => ({
  closeScheduledMailNotifications:
    vi.fn<typeof closeScheduledMailNotifications>(),
  dispatchPendingScheduledMailNotifications: vi.fn<
    typeof dispatchPendingScheduledMailNotifications
  >(async () => {}),
  releaseStaleScheduledMailNotificationClaims: vi.fn<
    typeof releaseStaleScheduledMailNotificationClaims
  >(async () => {}),
  showScheduledMailNotification: vi.fn<typeof showScheduledMailNotification>(
    async () => {}
  ),
}));

const {
  adoptLegacyScheduledMailAttachments,
  beginScheduledMailEdit,
  discardScheduledMail,
  finishScheduledMailEdit,
  startScheduledMail,
  stopScheduledMail,
} = await import("../src/main/mail/scheduled-mail");
const { configureDraftAttachmentStore } =
  await import("../src/main/mail/draft-attachment-store");
const { outgoingAttachmentAuthorizations } =
  await import("../src/main/mail/outgoing-attachment-authorizations");
const { sendNewMessage: sendNewMessageMock } =
  await import("../src/main/mail/engine/mail-send");

const accountId = "person@example.com";
const draftId = "scheduled-save-draft";
const temporaryDirectories: string[] = [];

insertGmailAccount(connection, accountId);

const insertScheduledDraft = (): void => {
  const scheduledAt = Date.now() + 60_000;
  connection
    .prepare(
      `INSERT INTO mail_drafts (
        account_email, attachments, bcc, body_html, body_text, cc, created_at,
        id, kind, subject, "to", updated_at
      ) VALUES (?, '[]', '[]', '<p>Hello</p>', 'Hello', '[]', 1, ?, 'new',
        'Original', '["friend@example.com"]', 1)`
    )
    .run(accountId, draftId);
  connection
    .prepare(
      `INSERT INTO scheduled_messages (
        attempt_count, created_at, draft_id, next_attempt_at, revision,
        rfc_message_id, scheduled_at, status, updated_at
      ) VALUES (0, 1, ?, ?, 1, '<stable@scheduled.kisa.invalid>', ?,
        'scheduled', 1)`
    )
    .run(draftId, scheduledAt, scheduledAt);
};

const saveScheduledSession = async ({
  ownerId,
  session,
  subject,
}: {
  readonly ownerId: number;
  readonly session: ScheduledMailEditSession;
  readonly subject: string;
}): Promise<ScheduledMailEditSession> => {
  const result = await Effect.runPromise(
    finishScheduledMailEdit(
      {
        accountId,
        action: {
          draft: { ...session.draft, subject },
          kind: "save",
        },
        draftId,
      },
      ownerId
    )
  );
  if (result.kind !== "saved") {
    throw new Error("Expected an in-place save result");
  }
  return result.session;
};

describe("scheduled mail in-place save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connection.prepare("DELETE FROM mail_drafts").run();
    insertScheduledDraft();
  });

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  afterAll(() => connection.close());

  it("reschedules from an older open editor snapshot", async () => {
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 71)
    );
    const secondSnapshot = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 72)
    );

    const saved = await saveScheduledSession({
      ownerId: 71,
      session: opened,
      subject: "  Normalized  ",
    });
    expect(saved).toMatchObject({
      draft: { subject: "Normalized" },
      item: { revision: 2 },
    });
    const scheduledAt = Date.now() + 120_000;
    const rescheduled = await Effect.runPromise(
      finishScheduledMailEdit(
        {
          accountId,
          action: {
            allowPossibleDuplicate: false,
            draft: { ...secondSnapshot.draft, subject: "Latest editor" },
            kind: "reschedule",
            scheduledAt,
          },
          draftId,
        },
        72
      )
    );
    expect(rescheduled).toMatchObject({
      kind: "saved",
      session: {
        draft: { subject: "Latest editor" },
        item: { revision: 3, scheduledAt },
      },
    });
  });

  it("asks for an acknowledgement before sending an email whose outcome became unknown after its editor opened", async () => {
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 71)
    );
    // The worker's attempt ends without a known outcome while the editor
    // still shows the snapshot from before it.
    connection
      .prepare(
        `UPDATE scheduled_messages
         SET attempt_count = 1, attention_reason = 'outcome-unknown',
             next_attempt_at = NULL, status = 'attention'
         WHERE draft_id = ?`
      )
      .run(draftId);
    const sendNow = (allowPossibleDuplicate: boolean) =>
      Effect.runPromise(
        finishScheduledMailEdit(
          {
            accountId,
            action: {
              allowPossibleDuplicate,
              draft: opened.draft,
              kind: "send-now",
            },
            draftId,
          },
          71
        )
      );
    const storedSchedule = () =>
      connection
        .prepare(
          `SELECT attention_reason AS attentionReason,
                  rfc_message_id AS rfcMessageId, status
           FROM scheduled_messages WHERE draft_id = ?`
        )
        .get(draftId);

    await expect(sendNow(false)).resolves.toStrictEqual({
      kind: "possible-duplicate",
    });
    expect(storedSchedule()).toStrictEqual({
      attentionReason: "outcome-unknown",
      rfcMessageId: "<stable@scheduled.kisa.invalid>",
      status: "attention",
    });

    await expect(sendNow(true)).resolves.toStrictEqual({ kind: "finished" });
    expect(storedSchedule()).toMatchObject({
      attentionReason: null,
      status: "scheduled",
    });
    expect(storedSchedule()).not.toMatchObject({
      rfcMessageId: "<stable@scheduled.kisa.invalid>",
    });
  });

  it("preserves actionable scheduled-mail state errors", async () => {
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 71)
    );
    connection
      .prepare("DELETE FROM scheduled_messages WHERE draft_id = ?")
      .run(draftId);

    await expect(
      saveScheduledSession({
        ownerId: 71,
        session: opened,
        subject: "Cannot save",
      })
    ).rejects.toMatchObject({
      message: "The scheduled email no longer exists",
    });
  });

  it("preserves actionable attachment errors", async () => {
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 71)
    );

    await expect(
      Effect.runPromise(
        finishScheduledMailEdit(
          {
            accountId,
            action: {
              draft: {
                ...opened.draft,
                attachments: [
                  {
                    filename: "notes.txt",
                    id: "attachment-1",
                    mediaType: "text/plain",
                    referenceId: "expired-reference",
                    size: 5,
                  },
                ],
              },
              kind: "save",
            },
            draftId,
          },
          71
        )
      )
    ).rejects.toMatchObject({
      message: "An attachment is no longer authorized; attach it again",
    });
  });

  it("delivers a due message while its editor snapshot is open", async () => {
    vi.mocked(sendNewMessageMock).mockReturnValue(
      Effect.succeed({ refused: [] })
    );
    connection
      .prepare(
        `UPDATE scheduled_messages
         SET next_attempt_at = 1, scheduled_at = 1
         WHERE draft_id = ?`
      )
      .run(draftId);
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 71)
    );

    await startScheduledMail();
    try {
      expect(opened.item.draftId).toBe(draftId);
      expect(sendNewMessageMock).toHaveBeenCalledOnce();
      expect(
        connection
          .prepare(
            "SELECT attention_reason AS attentionReason, status FROM scheduled_messages WHERE draft_id = ?"
          )
          .get(draftId)
      ).toStrictEqual({ attentionReason: null, status: "sent" });
    } finally {
      await stopScheduledMail();
    }
  });

  it("delivers the app-owned attachment after its source file is deleted", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "kisa-scheduled-save-attachment-")
    );
    temporaryDirectories.push(directory);
    configureDraftAttachmentStore(path.join(directory, "user-data"));
    const sourcePath = path.join(directory, "notes.txt");
    await writeFile(sourcePath, "scheduled contents");
    const [attachment] =
      await outgoingAttachmentAuthorizations.authorizeSelections(101, {
        files: [{ mediaType: "text/plain", path: sourcePath }],
      });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 101)
    );
    const saved = await Effect.runPromise(
      finishScheduledMailEdit(
        {
          accountId,
          action: {
            draft: { ...opened.draft, attachments: [attachment] },
            kind: "save",
          },
          draftId,
        },
        101
      )
    );
    expect(saved.kind).toBe("saved");
    const stored = connection
      .prepare("SELECT attachments FROM mail_drafts WHERE id = ?")
      .get(draftId) as { readonly attachments: string };
    const storedAttachments = JSON.parse(stored.attachments) as readonly {
      readonly path: string;
      readonly storage: string;
    }[];
    expect(storedAttachments).toStrictEqual([
      expect.objectContaining({ storage: "app-owned" }),
    ]);
    const [ownedAttachment] = storedAttachments;
    if (ownedAttachment === undefined) {
      throw new Error("Expected a stored attachment");
    }

    await unlink(sourcePath);
    vi.mocked(sendNewMessageMock).mockReturnValue(
      Effect.succeed({ refused: [] })
    );
    connection
      .prepare(
        `UPDATE scheduled_messages
         SET next_attempt_at = 1, scheduled_at = 1
         WHERE draft_id = ?`
      )
      .run(draftId);

    await startScheduledMail();
    try {
      expect(sendNewMessageMock).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId,
          attachments: [
            expect.objectContaining({
              bytes: Buffer.from("scheduled contents"),
              filename: "notes.txt",
              mediaType: "text/plain",
            }),
          ],
        })
      );
      await expect(access(ownedAttachment.path)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await stopScheduledMail();
    }
  });

  it("preserves an inline image across app-owned storage and reopen", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "kisa-scheduled-inline-image-")
    );
    temporaryDirectories.push(directory);
    configureDraftAttachmentStore(path.join(directory, "user-data"));
    const sourcePath = path.join(directory, "inline.jpg");
    const bytes = Uint8Array.from([255, 216, 255, 217]);
    await writeFile(sourcePath, bytes);
    const [attachment] =
      await outgoingAttachmentAuthorizations.authorizeSelections(104, {
        files: [{ mediaType: "image/jpeg", path: sourcePath }],
      });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const contentId = "saved@inline.kisa.email";
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 104)
    );

    await Effect.runPromise(
      finishScheduledMailEdit(
        {
          accountId,
          action: {
            draft: {
              ...opened.draft,
              attachments: [{ ...attachment, contentId }],
              body: {
                html: `<p>Hello</p><img alt="inline.jpg" src="cid:${contentId}">`,
                text: "Hello\n[Image: inline.jpg]",
              },
            },
            kind: "save",
          },
          draftId,
        },
        104
      )
    );
    const stored = connection
      .prepare("SELECT attachments FROM mail_drafts WHERE id = ?")
      .get(draftId) as { readonly attachments: string };
    const storedAttachments = decodeStoredOutgoingAttachmentsStrict(
      JSON.parse(stored.attachments)
    );
    if (storedAttachments === undefined) {
      throw new Error("Expected stored attachments");
    }
    expect(storedAttachments[0]?.contentId).toBe(contentId);
    connection
      .prepare("UPDATE mail_drafts SET attachments = ? WHERE id = ?")
      .run(
        JSON.stringify(
          storedAttachments.map(
            ({ contentId: _lostContentId, ...storedAttachment }) =>
              storedAttachment
          )
        ),
        draftId
      );
    const reopened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 105)
    );
    const [restored] = reopened.draft.attachments;
    if (restored === undefined) {
      throw new Error("Expected a restored attachment");
    }

    expect(restored.contentId).toBe(contentId);
    await expect(
      Effect.runPromise(
        outgoingAttachmentAuthorizations.loadInlineImagePreview(
          105,
          restored.referenceId
        )
      )
    ).resolves.toStrictEqual({ bytes, mediaType: "image/jpeg" });

    await Promise.all([
      outgoingAttachmentAuthorizations.releaseOwner(104),
      outgoingAttachmentAuthorizations.releaseOwner(105),
    ]);
  });

  it("removes the app-owned attachment when the schedule is discarded", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "kisa-scheduled-discard-attachment-")
    );
    temporaryDirectories.push(directory);
    configureDraftAttachmentStore(path.join(directory, "user-data"));
    const sourcePath = path.join(directory, "discard.txt");
    await writeFile(sourcePath, "discard contents");
    const [attachment] =
      await outgoingAttachmentAuthorizations.authorizeSelections(102, {
        files: [{ mediaType: "text/plain", path: sourcePath }],
      });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 102)
    );
    await Effect.runPromise(
      finishScheduledMailEdit(
        {
          accountId,
          action: {
            draft: { ...opened.draft, attachments: [attachment] },
            kind: "save",
          },
          draftId,
        },
        102
      )
    );
    const stored = connection
      .prepare("SELECT attachments FROM mail_drafts WHERE id = ?")
      .get(draftId) as { readonly attachments: string };
    const [ownedAttachment] = JSON.parse(stored.attachments) as readonly {
      readonly path: string;
    }[];
    if (ownedAttachment === undefined) {
      throw new Error("Expected a stored attachment");
    }

    await Effect.runPromise(discardScheduledMail({ accountId, draftId }));

    await expect(access(ownedAttachment.path)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      connection.prepare("SELECT id FROM mail_drafts WHERE id = ?").get(draftId)
    ).toBeUndefined();
  });

  it("adopts an older scheduled attachment before delivery starts", async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "kisa-scheduled-legacy-attachment-")
    );
    temporaryDirectories.push(directory);
    configureDraftAttachmentStore(path.join(directory, "user-data"));
    const sourcePath = path.join(directory, "legacy.txt");
    await writeFile(sourcePath, "legacy contents");
    const [attachment] =
      await outgoingAttachmentAuthorizations.authorizeSelections(103, {
        files: [{ mediaType: "text/plain", path: sourcePath }],
      });
    if (attachment === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const legacyAttachments =
      outgoingAttachmentAuthorizations.serializeDraftAttachments(103, [
        attachment,
      ]);
    connection
      .prepare("UPDATE mail_drafts SET attachments = ? WHERE id = ?")
      .run(JSON.stringify(legacyAttachments), draftId);

    await Effect.runPromise(adoptLegacyScheduledMailAttachments());

    const stored = connection
      .prepare("SELECT attachments FROM mail_drafts WHERE id = ?")
      .get(draftId) as { readonly attachments: string };
    const [ownedAttachment] = JSON.parse(stored.attachments) as readonly {
      readonly path: string;
      readonly storage: string;
    }[];
    expect(ownedAttachment?.storage).toBe("app-owned");
    await unlink(sourcePath);
    await expect(access(ownedAttachment?.path ?? "")).resolves.toBeUndefined();
  });

  it("uses the refreshed revision for repeated saves and rescheduling", async () => {
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 81)
    );
    const firstSave = await saveScheduledSession({
      ownerId: 81,
      session: opened,
      subject: "Normalized",
    });
    const secondSave = await saveScheduledSession({
      ownerId: 81,
      session: firstSave,
      subject: "Saved again",
    });
    expect(secondSave).toMatchObject({
      draft: { subject: "Saved again" },
      item: { revision: 3 },
    });

    const scheduledAt = Date.now() + 120_000;
    const rescheduled = await Effect.runPromise(
      finishScheduledMailEdit(
        {
          accountId,
          action: {
            allowPossibleDuplicate: false,
            draft: secondSave.draft,
            kind: "reschedule",
            scheduledAt,
          },
          draftId,
        },
        81
      )
    );
    expect(rescheduled).toMatchObject({
      kind: "saved",
      session: { item: { revision: 4, scheduledAt } },
    });
    expect(
      connection
        .prepare(
          "SELECT revision, scheduled_at AS scheduledAt, subject FROM scheduled_messages JOIN mail_drafts ON mail_drafts.id = scheduled_messages.draft_id WHERE draft_id = ?"
        )
        .get(draftId)
    ).toMatchObject({ revision: 4, scheduledAt, subject: "Saved again" });
  });

  it("preserves a rate-limit backoff when saving draft content", async () => {
    const lastAttemptAt = Date.now() - 30_000;
    const rateLimitStartedAt = Date.now() - 60_000;
    const nextAttemptAt = Date.now() + 15 * 60_000;
    connection
      .prepare(
        `UPDATE scheduled_messages
         SET attempt_count = 4, last_attempt_at = ?, next_attempt_at = ?,
             rate_limit_started_at = ?
         WHERE draft_id = ?`
      )
      .run(lastAttemptAt, nextAttemptAt, rateLimitStartedAt, draftId);
    const opened = await Effect.runPromise(
      beginScheduledMailEdit({ accountId, draftId }, 91)
    );

    const saved = await saveScheduledSession({
      ownerId: 91,
      session: opened,
      subject: "Edited during backoff",
    });

    expect(saved).toMatchObject({
      draft: { subject: "Edited during backoff" },
      item: {
        deliveryState: "retrying",
        nextAttemptAt,
        revision: 2,
      },
    });
    expect(
      connection
        .prepare(
          `SELECT attempt_count AS attemptCount,
                  attempt_id AS attemptId,
                  last_attempt_at AS lastAttemptAt,
                  next_attempt_at AS nextAttemptAt,
                  rate_limit_started_at AS rateLimitStartedAt,
                  revision,
                  rfc_message_id AS rfcMessageId,
                  status
           FROM scheduled_messages
           WHERE draft_id = ?`
        )
        .get(draftId)
    ).toStrictEqual({
      attemptCount: 4,
      attemptId: null,
      lastAttemptAt,
      nextAttemptAt,
      rateLimitStartedAt,
      revision: 2,
      rfcMessageId: "<stable@scheduled.kisa.invalid>",
      status: "scheduled",
    });
  });
});
