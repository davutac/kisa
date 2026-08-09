// oxlint-disable typescript/no-unsafe-type-assertion
import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { Effect } from "effect";
import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  showNewMailNotifications,
  toNewMailNotificationCopy,
} from "../src/main/mail/new-mail-notifications";

interface TestMessageRow {
  readonly fromAddress: string;
  readonly fromName: string | null;
  readonly internalDate: number;
  readonly labelIds: readonly string[];
  readonly messageId: string;
  readonly subject: string;
  readonly threadId: string;
}

const mocks = vi.hoisted(() => ({
  appFocus: vi.fn(),
  brandIcon: { isEmpty: () => false },
  createdNotifications: [] as Record<string, unknown>[],
  mainWindow: {
    focus: vi.fn(),
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
  },
  notificationListeners: [] as Map<string, () => void>[],
  openThreadWindow: vi.fn(() => Promise.resolve()),
  messages: [] as TestMessageRow[],
  notificationsEnabled: true,
  threads: [] as { readonly snippet: string; readonly threadId: string }[],
}));

vi.mock(import("electron"), () => {
  class TestNotification {
    static isSupported = (): boolean => true;

    constructor(options: Record<string, unknown>) {
      mocks.createdNotifications.push(options);
      mocks.notificationListeners.push(new Map());
    }

    once(event: string, listener: () => void): this {
      mocks.notificationListeners.at(-1)?.set(event, listener);
      return this;
    }

    show(): void {
      void this.once();
    }
  }

  return {
    BrowserWindow: {
      getAllWindows: vi.fn<() => never[]>(() => []),
    } as unknown as typeof Electron.BrowserWindow,
    Notification: TestNotification as unknown as typeof Electron.Notification,
    app: {
      focus: mocks.appFocus,
    } as unknown as typeof Electron.app,
    nativeImage: {
      createFromBuffer: vi.fn<() => typeof mocks.brandIcon>(
        () => mocks.brandIcon
      ),
    } as unknown as typeof Electron.nativeImage,
  };
});

vi.mock(import("../src/main/database"), async () => {
  const { Effect: EffectModule } = await import("effect");
  const database = {
    query: {
      accountSettings: {
        findFirst: () =>
          Promise.resolve({
            notificationsEnabled: mocks.notificationsEnabled,
          }),
      },
      gmailMessages: { findMany: () => Promise.resolve(mocks.messages) },
      gmailThreads: { findMany: () => Promise.resolve(mocks.threads) },
    },
  };

  return {
    withDatabaseClient: <A>(
      run: (client: RemoteDatabaseClient) => Promise<A>
    ) =>
      EffectModule.promise(() =>
        run(database as unknown as RemoteDatabaseClient)
      ),
  };
});

vi.mock(import("../src/main/window/create-window"), () => ({
  createWindow: vi.fn<() => Electron.BrowserWindow>(() => {
    throw new Error("Unexpected window creation");
  }),
  getMainWindow: vi.fn(() => mocks.mainWindow),
  openThreadWindow: mocks.openThreadWindow,
}));

const makeMessage = (
  messageId: string,
  labelIds: readonly string[]
): TestMessageRow => ({
  fromAddress: "sender@example.com",
  fromName: "Sender",
  internalDate: 1,
  labelIds,
  messageId,
  subject: "A subject",
  threadId: `thread-${messageId}`,
});

describe(showNewMailNotifications, () => {
  beforeEach(() => {
    mocks.appFocus.mockClear();
    mocks.createdNotifications.length = 0;
    mocks.notificationListeners.length = 0;
    mocks.messages = [];
    mocks.mainWindow.focus.mockClear();
    mocks.mainWindow.restore.mockClear();
    mocks.mainWindow.show.mockClear();
    mocks.notificationsEnabled = true;
    mocks.openThreadWindow.mockReset();
    mocks.openThreadWindow.mockResolvedValue({
      focus: vi.fn(),
      isDestroyed: () => false,
      show: vi.fn(),
    });
    mocks.threads = [];
  });

  it("bounds and strips control characters from sender-owned text", () => {
    const copy = toNewMailNotificationCopy({
      accountId: "user@example.com",
      fromAddress: "sender@example.com",
      fromName: `Trusted\u0000\u202Eevil${"🙂".repeat(40)}`,
      messageId: "new",
      snippet: "Preview",
      subject: "Subject",
      threadId: "thread-new",
    });

    expect(copy.title).not.toContain("\u0000");
    expect(copy.title).not.toContain("\u202E");
    expect(Buffer.byteLength(copy.title, "utf-8")).toBeLessThanOrEqual(64);
  });

  it("does no notification or brand work for a disabled account", async () => {
    mocks.notificationsEnabled = false;
    const resolveBrand = vi.fn<() => Effect.Effect<null>>(() =>
      Effect.succeed(null)
    );

    await Effect.runPromise(
      showNewMailNotifications("user@example.com", ["new"], resolveBrand)
    );

    expect(resolveBrand).not.toHaveBeenCalled();
    expect(mocks.createdNotifications).toStrictEqual([]);
  });

  it("notifies only for unread Inbox messages", async () => {
    mocks.messages = [
      makeMessage("new", ["INBOX", "UNREAD"]),
      makeMessage("read", ["INBOX"]),
      makeMessage("archived", ["UNREAD"]),
    ];
    mocks.threads = [{ snippet: "A short preview", threadId: "thread-new" }];
    const resolveBrand = vi.fn<() => Effect.Effect<null>>(() =>
      Effect.succeed(null)
    );

    await Effect.runPromise(
      showNewMailNotifications(
        "user@example.com",
        ["new", "read", "archived"],
        resolveBrand
      )
    );

    expect(resolveBrand).toHaveBeenCalledOnce();
    expect(mocks.createdNotifications).toHaveLength(1);
    expect(mocks.createdNotifications[0]).toMatchObject({
      actions: [{ text: "Open", type: "button" }],
      body: "A short preview",
      subtitle: "A subject",
      title: "Sender <sender@example.com>",
    });
  });

  it.each(["action", "click"])(
    "opens the account-scoped thread when the notification receives %s",
    async (event) => {
      mocks.messages = [makeMessage("new", ["INBOX", "UNREAD"])];
      mocks.threads = [{ snippet: "Preview", threadId: "thread-new" }];

      await Effect.runPromise(
        showNewMailNotifications("user@example.com", ["new"], () =>
          Effect.succeed(null)
        )
      );

      mocks.notificationListeners[0]?.get(event)?.();

      await vi.waitFor(() => {
        expect(mocks.openThreadWindow).toHaveBeenCalledWith({
          accountId: "user@example.com",
          threadId: "thread-new",
        });
      });
      expect(mocks.appFocus).toHaveBeenCalledWith({ steal: true });
    }
  );

  it("focuses the main window when the notification thread cannot open", async () => {
    mocks.messages = [makeMessage("new", ["INBOX", "UNREAD"])];
    mocks.threads = [{ snippet: "Preview", threadId: "thread-new" }];
    mocks.openThreadWindow.mockRejectedValue(new Error("load failed"));

    await Effect.runPromise(
      showNewMailNotifications("user@example.com", ["new"], () =>
        Effect.succeed(null)
      )
    );

    mocks.notificationListeners[0]?.get("click")?.();

    await vi.waitFor(() => {
      expect(mocks.mainWindow.focus).toHaveBeenCalledOnce();
    });
  });

  it("rasterizes an authenticated BIMI logo for the native icon", async () => {
    mocks.messages = [makeMessage("branded", ["INBOX", "UNREAD"])];
    mocks.threads = [{ snippet: "Preview", threadId: "thread-branded" }];
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>'
    ).toString("base64");

    await Effect.runPromise(
      showNewMailNotifications("user@example.com", ["branded"], () =>
        Effect.succeed({
          domain: "example.com",
          imageDataUrl: `data:image/svg+xml;base64,${svg}`,
          source: "bimi" as const,
        })
      )
    );

    expect(mocks.createdNotifications).toHaveLength(1);
    expect(mocks.createdNotifications[0]).toMatchObject({
      icon: mocks.brandIcon,
    });
  });
});
