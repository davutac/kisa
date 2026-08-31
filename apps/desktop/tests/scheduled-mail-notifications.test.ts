import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import type { ScheduledMailOutcome } from "../src/shared/ipc/scheduled-mail";

type RendererSend = ReturnType<
  typeof vi.fn<(channel: string, payload: ScheduledMailOutcome) => void>
>;

interface FakeWebContents {
  readonly emit: (event: string) => void;
  readonly id: number;
  readonly markDestroyed: () => void;
  readonly send: RendererSend;
  readonly setLoading: (loading: boolean) => void;
  isDestroyed: () => boolean;
  isLoadingMainFrame: () => boolean;
  on: (event: string, listener: () => void) => unknown;
  once: (event: string, listener: () => void) => unknown;
}

interface FakeWindow {
  readonly webContents: FakeWebContents;
  focus: ReturnType<typeof vi.fn>;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
}

interface FakeNotificationInstance {
  readonly emit: (event: "click" | "close") => void;
  readonly options: { readonly body: string; readonly title: string };
}

const state = vi.hoisted(() => ({
  database: undefined as RemoteDatabaseClient | undefined,
  mainWindow: undefined as FakeWindow | undefined,
  nativeNotifications: [] as FakeNotificationInstance[],
  nativeSupported: false,
  nextWindow: undefined as FakeWindow | undefined,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("../src/main/database-query", () => ({
  withDatabaseClient: ((run) =>
    Effect.promise(() => {
      if (state.database === undefined) {
        throw new Error("Expected a test database");
      }
      return run(state.database);
    })) satisfies typeof withDatabaseClient,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("../src/main/window/create-window", () => ({
  createWindow: () => {
    if (state.nextWindow === undefined) {
      throw new Error("Expected a test window");
    }
    state.mainWindow = state.nextWindow;
    return state.nextWindow;
  },
  getMainWindow: () => state.mainWindow,
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class FakeNotification {
    static isSupported(): boolean {
      return state.nativeSupported;
    }

    readonly #events = new EventTarget();
    readonly options: { readonly body: string; readonly title: string };

    constructor(options: { readonly body: string; readonly title: string }) {
      this.options = options;
    }

    close(): void {
      this.#events.dispatchEvent(new Event("close"));
    }

    emit(event: "click" | "close"): void {
      this.#events.dispatchEvent(new Event(event));
    }

    once(event: "click" | "close", listener: () => void): void {
      this.#events.addEventListener(event, () => listener(), { once: true });
    }

    show(): void {
      state.nativeNotifications.push(this);
    }
  },
  app: { focus: vi.fn<() => void>() },
}));

const {
  closeScheduledMailNotifications,
  setScheduledMailOutcomeTargetReady,
  showScheduledMailNotification,
} = await import("../src/main/mail/scheduled-mail-notifications");
const { configureDraftAttachmentStore } =
  await import("../src/main/mail/draft-attachment-store");
const { authorizeOutgoingAttachmentFiles } =
  await import("../src/main/mail/outgoing-attachment-files");

const migrationsFolder = fileURLToPath(
  new URL("../../../packages/database/drizzle", import.meta.url)
);
const temporaryDirectories: string[] = [];
let connection: ReturnType<typeof openDatabaseConnection> | undefined;

const createFakeWebContents = (id: number): FakeWebContents => {
  const events = new EventTarget();
  let destroyed = false;
  let loading = false;
  return {
    emit: (event) => events.dispatchEvent(new Event(event)),
    id,
    isDestroyed: () => destroyed,
    isLoadingMainFrame: () => loading,
    markDestroyed: () => {
      destroyed = true;
      events.dispatchEvent(new Event("destroyed"));
    },
    on: (event, listener) => events.addEventListener(event, () => listener()),
    once: (event, listener) =>
      events.addEventListener(event, () => listener(), { once: true }),
    send: vi.fn<(channel: string, payload: ScheduledMailOutcome) => void>(),
    setLoading: (next) => {
      loading = next;
    },
  };
};

const createFakeWindow = (id: number): FakeWindow => ({
  focus: vi.fn<() => void>(),
  isDestroyed: () => false,
  isMinimized: () => false,
  isVisible: () => true,
  restore: vi.fn<() => void>(),
  show: vi.fn<() => void>(),
  webContents: createFakeWebContents(id),
});

const toRemoteDatabase = (
  databaseConnection: ReturnType<typeof openDatabaseConnection>
): RemoteDatabaseClient => {
  const execute: DatabaseRemoteCallback = (query, parameters, method) => {
    const statement = databaseConnection.prepare(query);
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

const insertAttention = (draftId: string): void => {
  connection
    ?.prepare(
      `INSERT INTO mail_drafts (
        account_email, attachments, bcc, body_html, body_text, cc,
        created_at, id, kind, message_id, subject, thread_id, "to", updated_at
      ) VALUES ('person@example.com', '[]', '[]', '<p>Hello</p>', 'Hello', '[]',
        1, ?, 'new', NULL, 'Subject', NULL, '["to@example.com"]', 1)`
    )
    .run(draftId);
  connection
    ?.prepare(
      `INSERT INTO scheduled_messages (
        attempt_count, attention_reason, created_at, draft_id, revision,
        rfc_message_id, scheduled_at, status, updated_at
      ) VALUES (0, 'message-invalid', 1, ?, 1,
        '<schedule@example.invalid>', 2, 'attention', 1)`
    )
    .run(draftId);
};

const insertSent = (draftId: string, attachments: string): void => {
  connection
    ?.prepare(
      `INSERT INTO mail_drafts (
        account_email, attachments, bcc, body_html, body_text, cc,
        created_at, id, kind, message_id, subject, thread_id, "to", updated_at
      ) VALUES ('person@example.com', ?, '[]', '<p>Hello</p>', 'Hello', '[]',
        1, ?, 'new', NULL, 'Subject', NULL, '["to@example.com"]', 1)`
    )
    .run(attachments, draftId);
  connection
    ?.prepare(
      `INSERT INTO scheduled_messages (
        attempt_count, created_at, draft_id, notified_at, revision,
        rfc_message_id, scheduled_at, status, updated_at
      ) VALUES (1, 1, ?, NULL, 1,
        '<schedule@example.invalid>', 2, 'sent', 1)`
    )
    .run(draftId);
};

describe("scheduled mail outcome readiness", () => {
  beforeEach(() => {
    const directory = mkdtempSync(path.join(tmpdir(), "kisa-notifications-"));
    temporaryDirectories.push(directory);
    connection = openDatabaseConnection(path.join(directory, "app.sqlite"));
    applyDatabaseMigrations(createDatabaseClient(connection), migrationsFolder);
    configureDraftAttachmentStore(path.join(directory, "user-data"));
    state.database = toRemoteDatabase(connection);
    state.mainWindow = undefined;
    state.nativeNotifications = [];
    state.nativeSupported = false;
    state.nextWindow = undefined;
  });

  afterEach(() => {
    closeScheduledMailNotifications("person@example.com");
    state.mainWindow?.webContents.markDestroyed();
    if (state.nextWindow !== state.mainWindow) {
      state.nextWindow?.webContents.markDestroyed();
    }
    connection?.close();
    connection = undefined;
    state.database = undefined;
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("uses a native fallback for a visible window whose renderer is not ready", async () => {
    const window = createFakeWindow(7);
    state.mainWindow = window;
    state.nativeSupported = true;
    insertAttention("draft-native");

    await showScheduledMailNotification({
      accountId: "person@example.com",
      draftId: "draft-native",
      kind: "attention",
    });

    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(state.nativeNotifications).toHaveLength(1);
    expect(state.nativeNotifications[0]?.options).toStrictEqual({
      body: "Open Kisa to review it.",
      title: "Scheduled email needs attention",
    });
  });

  it("replays an unacknowledged outcome once its renderer becomes ready", async () => {
    const window = createFakeWindow(8);
    state.mainWindow = window;
    insertAttention("draft-replay");

    await showScheduledMailNotification({
      accountId: "person@example.com",
      draftId: "draft-replay",
      kind: "attention",
    });
    expect(window.webContents.send).not.toHaveBeenCalled();

    await setScheduledMailOutcomeTargetReady(window.webContents, true);

    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
      "desktop:scheduled-mail:outcome",
      {
        accountId: "person@example.com",
        draftId: "draft-replay",
        intent: "feedback",
        kind: "attention",
      }
    );
  });

  it("requires readiness again after the renderer starts reloading", async () => {
    const window = createFakeWindow(9);
    state.mainWindow = window;
    await setScheduledMailOutcomeTargetReady(window.webContents, true);
    window.webContents.emit("did-start-loading");
    insertAttention("draft-reload");

    await showScheduledMailNotification({
      accountId: "person@example.com",
      draftId: "draft-reload",
      kind: "attention",
    });
    expect(window.webContents.send).not.toHaveBeenCalled();

    await setScheduledMailOutcomeTargetReady(window.webContents, true);
    expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(
      "desktop:scheduled-mail:outcome",
      expect.objectContaining({ draftId: "draft-reload" })
    );
  });

  it("does not inherit readiness when a destroyed renderer is replaced", async () => {
    const oldWindow = createFakeWindow(10);
    await setScheduledMailOutcomeTargetReady(oldWindow.webContents, true);
    oldWindow.webContents.markDestroyed();
    const replacement = createFakeWindow(10);
    state.mainWindow = replacement;
    insertAttention("draft-replaced-renderer");

    await showScheduledMailNotification({
      accountId: "person@example.com",
      draftId: "draft-replaced-renderer",
      kind: "attention",
    });

    expect(replacement.webContents.send).not.toHaveBeenCalled();
  });

  it("defers a native notification click until the created renderer is ready", async () => {
    const createdWindow = createFakeWindow(11);
    createdWindow.webContents.setLoading(true);
    state.nextWindow = createdWindow;
    state.nativeSupported = true;
    insertAttention("draft-click");
    await showScheduledMailNotification({
      accountId: "person@example.com",
      draftId: "draft-click",
      kind: "attention",
    });

    state.nativeNotifications[0]?.emit("click");
    createdWindow.webContents.setLoading(false);
    createdWindow.webContents.emit("did-finish-load");
    expect(createdWindow.webContents.send).not.toHaveBeenCalled();

    await setScheduledMailOutcomeTargetReady(createdWindow.webContents, true);
    expect(createdWindow.webContents.send).toHaveBeenCalledExactlyOnceWith(
      "desktop:scheduled-mail:outcome",
      {
        accountId: "person@example.com",
        draftId: "draft-click",
        intent: "open",
        kind: "attention",
      }
    );
  });

  it("deletes app-owned attachments after a sent outcome is confirmed", async () => {
    const directory = temporaryDirectories.at(-1);
    if (directory === undefined) {
      throw new Error("Expected a temporary directory");
    }
    const sourcePath = path.join(directory, "sent-attachment.txt");
    writeFileSync(sourcePath, "sent contents");
    const [record] = await authorizeOutgoingAttachmentFiles(
      [{ mediaType: "text/plain", path: sourcePath }],
      () => "sent-attachment"
    );
    if (record === undefined) {
      throw new Error("Expected an authorized attachment");
    }
    const store = configureDraftAttachmentStore(
      path.join(directory, "user-data")
    );
    const adoption = await Effect.runPromise(
      store.adopt("draft-sent", [record])
    );
    const [owned] = adoption.attachments;
    if (owned === undefined) {
      throw new Error("Expected an app-owned attachment");
    }
    insertSent("draft-sent", JSON.stringify(adoption.attachments));
    const window = createFakeWindow(12);
    state.mainWindow = window;
    await setScheduledMailOutcomeTargetReady(window.webContents, true);

    await showScheduledMailNotification({
      accountId: "person@example.com",
      draftId: "draft-sent",
      kind: "sent",
    });

    expect(existsSync(owned.path)).toBeFalsy();
    expect(
      connection
        ?.prepare("SELECT id FROM mail_drafts WHERE id = ?")
        .get("draft-sent")
    ).toBeUndefined();
  });
});
