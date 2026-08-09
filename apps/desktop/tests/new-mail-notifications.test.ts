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
  brandIcon: { isEmpty: () => false },
  createdNotifications: [] as Record<string, unknown>[],
  messages: [] as TestMessageRow[],
  notificationsEnabled: true,
  threads: [] as { readonly snippet: string; readonly threadId: string }[],
}));

vi.mock(import("electron"), () => {
  class TestNotification {
    static isSupported = (): boolean => true;

    constructor(options: Record<string, unknown>) {
      mocks.createdNotifications.push(options);
    }

    once(): this {
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
      focus: vi.fn<(options?: { steal?: boolean }) => void>(),
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
    mocks.createdNotifications.length = 0;
    mocks.messages = [];
    mocks.notificationsEnabled = true;
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
      body: "A subject — A short preview",
      title: "Sender",
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
