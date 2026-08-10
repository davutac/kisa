// oxlint-disable typescript/no-unsafe-type-assertion
import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { Effect } from "effect";
import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  dismissThreadNotifications,
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
  appFocus: vi.fn<typeof Electron.app.focus>(),
  brandIcon: { isEmpty: () => false },
  closedNotificationIds: [] as string[],
  createdNotifications: [] as Record<string, unknown>[],
  mainWindow: {
    focus: vi.fn<() => void>(),
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn<() => void>(),
    show: vi.fn<() => void>(),
  },
  messages: [] as TestMessageRow[],
  notificationListeners: [] as Map<string, () => void>[],
  notificationsEnabled: true,
  openThreadWindow:
    vi.fn<
      (request: {
        readonly accountId: string;
        readonly threadId: string;
      }) => Promise<Electron.BrowserWindow>
    >(),
  threads: [] as { readonly snippet: string; readonly threadId: string }[],
}));

vi.mock(import("electron"), () => {
  class TestNotification {
    static isSupported = (): boolean => true;
    readonly id: string;
    readonly listeners = new Map<string, () => void>();

    constructor(options: Record<string, unknown>) {
      this.id = String(options.id);
      mocks.createdNotifications.push(options);
      mocks.notificationListeners.push(this.listeners);
    }

    once(event: string, listener: () => void): this {
      this.listeners.set(event, listener);
      return this;
    }

    readonly close = vi.fn<() => void>(() => {
      mocks.closedNotificationIds.push(this.id);
      this.listeners.get("close")?.();
    });

    readonly show = vi.fn<() => void>();
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
  getMainWindow: vi.fn<() => Electron.BrowserWindow | undefined>(
    () => mocks.mainWindow as unknown as Electron.BrowserWindow
  ),
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
    for (const listeners of mocks.notificationListeners) {
      listeners.get("close")?.();
    }

    mocks.appFocus.mockClear();
    mocks.closedNotificationIds.length = 0;
    mocks.createdNotifications.length = 0;
    mocks.notificationListeners.length = 0;
    mocks.messages = [];
    mocks.mainWindow.focus.mockClear();
    mocks.mainWindow.restore.mockClear();
    mocks.mainWindow.show.mockClear();
    mocks.notificationsEnabled = true;
    mocks.openThreadWindow.mockReset();
    mocks.openThreadWindow.mockResolvedValue({
      focus: vi.fn<() => void>(),
      isDestroyed: () => false,
      show: vi.fn<() => void>(),
    } as unknown as Electron.BrowserWindow);
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

  it("dismisses only notifications for the matching account and thread", async () => {
    mocks.messages = [
      { ...makeMessage("first", ["INBOX", "UNREAD"]), threadId: "shared" },
      { ...makeMessage("second", ["INBOX", "UNREAD"]), threadId: "shared" },
      makeMessage("other", ["INBOX", "UNREAD"]),
    ];
    mocks.threads = [
      { snippet: "Shared", threadId: "shared" },
      { snippet: "Other", threadId: "thread-other" },
    ];

    await Effect.runPromise(
      showNewMailNotifications(
        "user@example.com",
        ["first", "second", "other"],
        () => Effect.succeed(null)
      )
    );
    mocks.messages = [
      { ...makeMessage("first", ["INBOX", "UNREAD"]), threadId: "shared" },
    ];
    await Effect.runPromise(
      showNewMailNotifications("other@example.com", ["first"], () =>
        Effect.succeed(null)
      )
    );

    dismissThreadNotifications("user@example.com", "shared");

    expect(mocks.closedNotificationIds).toStrictEqual([
      "user@example.com:first",
      "user@example.com:second",
    ]);
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
