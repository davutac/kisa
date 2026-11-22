// The Add account window's IPC boundary: who may submit, what a malformed or
// valid submission returns, what closing the window stops, and that both
// preloads speak the channels main listens on. Verification itself is
// replaced here; tests/password-account.test.ts covers it.
// oxlint-disable typescript/no-unsafe-type-assertion vitest/prefer-import-in-mock
import { AccountId } from "@repo/mail/ids";
import { Effect, Redacted, Scope } from "effect";
import type * as Electron from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  savePasswordAccount,
  verifyPasswordAccount,
} from "../src/main/auth/password-account";
import * as DesktopIpc from "../src/main/ipc/desktop-ipc";
import type { AccountSetupBridge } from "../src/shared/ipc/account-setup";
import type { GoogleAccountsReply } from "../src/shared/ipc/auth";
import {
  ACCOUNT_SETUP_CLOSE_CHANNEL,
  ACCOUNT_SETUP_SUBMIT_CHANNEL,
  AUTH_OPEN_ACCOUNT_SETUP_CHANNEL,
} from "../src/shared/ipc/channels";
import { APPLE_APP_PASSWORD_GUIDE_URL } from "../src/shared/mail-account-presets";

type Listener = (...args: unknown[]) => void;

class FakeWindow {
  closed = false;
  readonly focus = vi.fn<() => void>();
  readonly handlers = new Map<string, Listener[]>();
  readonly loadFile = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly loadURL = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly options: { readonly preload?: string };
  readonly restore = vi.fn<() => void>();
  readonly setFullScreenable = vi.fn<(value: boolean) => void>();
  readonly setMaximizable = vi.fn<(value: boolean) => void>();
  readonly setResizable = vi.fn<(value: boolean) => void>();
  readonly show = vi.fn<() => void>();
  readonly webContents: {
    readonly handlers: Map<string, Listener[]>;
    readonly id: number;
    openHandler?: (details: { readonly url: string }) => unknown;
    readonly on: (event: string, listener: Listener) => void;
    readonly setWindowOpenHandler: (
      handler: (details: { readonly url: string }) => unknown
    ) => void;
  };

  constructor(id: number, options: { readonly preload?: string }) {
    this.options = options;
    const handlers = new Map<string, Listener[]>();
    this.webContents = {
      handlers,
      id,
      on: (event, listener) => {
        handlers.set(event, [...(handlers.get(event) ?? []), listener]);
      },
      setWindowOpenHandler(handler) {
        this.openHandler = handler;
      },
    };
  }

  close(): void {
    this.destroy();
  }

  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const listener of this.handlers.get("closed") ?? []) {
      listener();
    }
  }

  isDestroyed(): boolean {
    return this.closed;
  }

  readonly isMinimized = vi.fn<() => boolean>(() => false);

  on(event: string, listener: Listener): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
  }

  once(event: string, listener: Listener): void {
    this.on(event, listener);
  }
}

const mocks = vi.hoisted(() => ({
  exposed: new Map<string, AccountSetupBridge>(),
  invoke: vi.fn<typeof Electron.ipcRenderer.invoke>(() => Promise.resolve()),
  mainWindow: undefined as
    | {
        readonly focus: () => void;
        readonly isMinimized: () => boolean;
        readonly restore: () => void;
        readonly show: () => void;
      }
    | undefined,
  nextWindowId: 40,
  notifyAccountsChanged: vi.fn<(reply: GoogleAccountsReply) => void>(),
  openExternalUrl: vi.fn<(url: string) => boolean>(() => true),
  save: vi.fn<typeof savePasswordAccount>(),
  verify: vi.fn<typeof verifyPasswordAccount>(),
  windows: [] as FakeWindow[],
}));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn<typeof Electron.contextBridge.exposeInMainWorld>(
      (key, api) => {
        mocks.exposed.set(key, api);
      }
    ),
  },
  ipcRenderer: { invoke: mocks.invoke },
}));

vi.mock(import("@electron-toolkit/utils"), () => ({ is: { dev: false } }));

vi.mock(import("../src/main/window/browser-window"), () => ({
  createBrowserWindow: ((options: { readonly preload?: string }) => {
    mocks.nextWindowId += 1;
    const window = new FakeWindow(mocks.nextWindowId, options);
    mocks.windows.push(window);
    return window;
  }) as never,
}));

vi.mock(import("../src/main/window/create-window"), () => ({
  getMainWindow: (() => mocks.mainWindow) as never,
}));

vi.mock(import("../src/main/electron/shell"), () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock(import("../src/main/auth/auth"), async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    listGoogleAccounts: (() =>
      MockEffect.succeed([{ email: "name@icloud.com", scopes: [] }])) as never,
    notifyGoogleAccountsChanged: mocks.notifyAccountsChanged,
  };
});

// Disconnecting reaches the mail engine and the database utility process.
vi.mock(import("../src/main/auth/disconnect-account"), () => ({
  disconnectGoogleAccount: vi.fn<() => never>() as never,
}));

// The live database layer would start the database utility process.
vi.mock(import("../src/main/mail/engine/mail-database-live"), async () => {
  const { Layer: MockLayer } = await import("effect");
  const { MailDatabase } =
    await import("../src/main/mail/engine/mail-database");
  return {
    MailDatabaseLive: MockLayer.succeed(
      MailDatabase,
      MailDatabase.of({ use: () => Effect.die("unused") })
    ),
  };
});

vi.mock(
  import("../src/main/auth/password-account"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    savePasswordAccount: mocks.save,
    verifyPasswordAccount: mocks.verify,
  })
);

const { closeAccountSetupWindow, submitPasswordAccount } =
  await import("../src/main/ipc/methods/account-setup");
const { openAccountSetup } = await import("../src/main/ipc/methods/auth");
const { PASSWORD_ACCOUNT_MESSAGES } =
  await import("../src/main/auth/password-account");

const PASSWORD = "abcd-efgh-ijkl-mnop";
const validRequest = { email: "name@icloud.com", password: PASSWORD };
const verified = {
  credentials: Buffer.from("sealed"),
  plan: {
    accountId: AccountId.make("name@icloud.com"),
    email: "name@icloud.com",
    imap: { host: "imap.mail.me.com", port: 993, security: "tls" as const },
    provider: "icloud" as const,
    smtp: {
      host: "smtp.mail.me.com",
      port: 587,
      security: "starttls" as const,
    },
    username: "name@icloud.com",
  },
};

/** Registers the methods as main does and returns their listeners. */
const installMethods = async () => {
  const listeners = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  const ipc = DesktopIpc.make({
    handle: (channel, listener) => {
      listeners.set(channel, listener);
    },
    removeHandler: (channel) => {
      listeners.delete(channel);
    },
  });
  // The scope stays open: closing it would unregister the handlers.
  const scope = await Effect.runPromise(Scope.make());
  await Effect.runPromise(
    Scope.provide(scope)(
      Effect.gen(function* registerMethods() {
        yield* ipc.handle(openAccountSetup);
        yield* ipc.handle(submitPasswordAccount);
        yield* ipc.handle(closeAccountSetupWindow);
      })
    )
  );
  return listeners;
};

/** What a renderer could send: a request, or anything else. */
type SubmitPayload =
  | string
  | { readonly email: string; readonly password: string };

const invoke = async (
  listeners: Map<string, DesktopIpc.DesktopIpcHandleListener>,
  channel: string,
  senderId: number,
  payload?: SubmitPayload
) =>
  await listeners.get(channel)?.(
    { sender: { id: senderId } } as IpcMainInvokeEvent,
    payload
  );

const openWindow = async () => {
  await Effect.runPromise(openAccountSetup.handler(undefined));
  const window = mocks.windows.at(-1);
  if (window === undefined) {
    throw new Error("no setup window");
  }
  return window;
};

describe("the Add account window", () => {
  beforeEach(() => {
    mocks.verify.mockReset();
    mocks.save.mockReset();
    mocks.verify.mockReturnValue(Effect.succeed(verified));
    mocks.save.mockReturnValue(Effect.succeed(verified.plan.accountId));
    mocks.notifyAccountsChanged.mockClear();
    mocks.openExternalUrl.mockClear();
    mocks.mainWindow = {
      focus: vi.fn<() => void>(),
      isMinimized: () => false,
      restore: vi.fn<() => void>(),
      show: vi.fn<() => void>(),
    };
  });

  afterEach(() => {
    for (const window of mocks.windows) {
      window.destroy();
    }
    mocks.windows.length = 0;
  });

  it("opens a fixed-size window with its own preload", async () => {
    const window = await openWindow();

    expect(openAccountSetup.channel).toBe(AUTH_OPEN_ACCOUNT_SETUP_CHANNEL);
    expect(window.options.preload).toMatch(/account-setup\.cjs$/u);
    expect(window.setResizable).toHaveBeenCalledWith(false);
  });

  it("focuses the open window instead of opening another", async () => {
    const window = await openWindow();
    const reply = await Effect.runPromise(openAccountSetup.handler(undefined));

    expect(reply).toStrictEqual({ data: undefined, ok: true });
    expect(mocks.windows).toHaveLength(1);
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("opens only Apple's guide, in the system browser, and never navigates", async () => {
    const window = await openWindow();
    const preventDefault = vi.fn<() => void>();

    expect(
      window.webContents.openHandler?.({ url: APPLE_APP_PASSWORD_GUIDE_URL })
    ).toStrictEqual({ action: "deny" });
    expect(
      window.webContents.openHandler?.({ url: "https://example.com/" })
    ).toStrictEqual({ action: "deny" });
    for (const listener of window.webContents.handlers.get("will-navigate") ??
      []) {
      listener({ preventDefault }, "https://example.com/");
    }

    expect(mocks.openExternalUrl.mock.calls).toStrictEqual([
      [APPLE_APP_PASSWORD_GUIDE_URL],
    ]);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("refuses a submission that does not come from the setup window", async () => {
    const listeners = await installMethods();
    await openWindow();

    const reply = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      1,
      validRequest
    );

    expect(reply).toStrictEqual({
      error: "Account setup is no longer open",
      ok: false,
    });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("answers a malformed submission with one fixed message that never echoes the password", async () => {
    const listeners = await installMethods();
    const window = await openWindow();

    const replies = await Promise.all(
      [
        { email: "not an address", password: PASSWORD },
        { email: "name@icloud.com", password: `${PASSWORD}\n` },
        { email: "name@icloud.com", password: PASSWORD.repeat(100) },
        PASSWORD,
      ].map((payload) =>
        invoke(
          listeners,
          ACCOUNT_SETUP_SUBMIT_CHANNEL,
          window.webContents.id,
          payload
        )
      )
    );

    for (const reply of replies) {
      expect(reply).toStrictEqual({
        error: PASSWORD_ACCOUNT_MESSAGES.invalidRequest,
        ok: false,
      });
    }
    expect(JSON.stringify(replies)).not.toContain(PASSWORD);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("verifies, saves, announces the accounts and closes after a valid submission", async () => {
    const listeners = await installMethods();
    const window = await openWindow();

    const reply = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      validRequest
    );

    expect(reply).toStrictEqual({ data: undefined, ok: true });
    expect(mocks.save).toHaveBeenCalledWith(verified);
    expect(mocks.notifyAccountsChanged).toHaveBeenCalledWith({
      data: [{ email: "name@icloud.com", scopes: [] }],
      ok: true,
    });
    expect(window.isDestroyed()).toBeTruthy();
    expect(mocks.mainWindow?.focus).toHaveBeenCalledWith();
  });

  it("hands verification the password already redacted", async () => {
    const listeners = await installMethods();
    const window = await openWindow();

    await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      validRequest
    );
    const password = mocks.verify.mock.calls[0]?.[0].password;

    expect(Redacted.isRedacted(password)).toBeTruthy();
    expect(password === undefined ? "" : Redacted.value(password)).toBe(
      PASSWORD
    );
  });

  it("passes on a verification failure's fixed message and keeps the window open", async () => {
    const { PasswordAccountError } =
      await import("../src/main/auth/password-account");
    mocks.verify.mockReturnValue(
      Effect.fail(
        new PasswordAccountError({
          message: PASSWORD_ACCOUNT_MESSAGES.icloudPasswordRefused,
        })
      )
    );
    const listeners = await installMethods();
    const window = await openWindow();

    const reply = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      validRequest
    );

    expect(reply).toStrictEqual({
      error: PASSWORD_ACCOUNT_MESSAGES.icloudPasswordRefused,
      ok: false,
    });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(window.isDestroyed()).toBeFalsy();
  });

  it("runs one submission at a time, and closing the window stops it unsaved", async () => {
    let interrupted = false;
    mocks.verify.mockReturnValue(
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        )
      )
    );
    const listeners = await installMethods();
    const window = await openWindow();

    const first = invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      validRequest
    );
    await vi.waitFor(() => {
      expect(mocks.verify).toHaveBeenCalledOnce();
    });
    const second = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      validRequest
    );
    await invoke(listeners, ACCOUNT_SETUP_CLOSE_CHANNEL, window.webContents.id);

    expect(second).toStrictEqual({ error: "Already signing in", ok: false });
    await expect(first).resolves.toStrictEqual({
      error: "Account setup was closed",
      ok: false,
    });
    expect(interrupted).toBeTruthy();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.notifyAccountsChanged).not.toHaveBeenCalled();
  });

  it("closes only when the setup window asks", async () => {
    const listeners = await installMethods();
    const window = await openWindow();

    await invoke(listeners, ACCOUNT_SETUP_CLOSE_CHANNEL, 1);
    expect(window.isDestroyed()).toBeFalsy();

    await invoke(listeners, ACCOUNT_SETUP_CLOSE_CHANNEL, window.webContents.id);
    expect(window.isDestroyed()).toBeTruthy();
  });
});

describe("the account setup preloads", () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
  });

  it("expose only submit and close, on the channels main listens on", async () => {
    await import("../src/preload/account-setup");
    const bridge = mocks.exposed.get("accountSetup");

    expect(Object.keys(bridge ?? {}).toSorted()).toStrictEqual([
      "close",
      "submit",
    ]);
    await bridge?.submit(validRequest);
    await bridge?.close();

    expect(mocks.invoke.mock.calls).toStrictEqual([
      [ACCOUNT_SETUP_SUBMIT_CHANNEL, validRequest],
      [ACCOUNT_SETUP_CLOSE_CHANNEL],
    ]);
    expect(submitPasswordAccount.channel).toBe(ACCOUNT_SETUP_SUBMIT_CHANNEL);
    expect(closeAccountSetupWindow.channel).toBe(ACCOUNT_SETUP_CLOSE_CHANNEL);
  });

  it("let the mail window open the setup window and nothing more", async () => {
    const { authApi } = await import("../src/preload/auth-api");

    await authApi.openAccountSetup();

    expect(mocks.invoke.mock.calls).toStrictEqual([
      [AUTH_OPEN_ACCOUNT_SETUP_CHANNEL],
    ]);
    expect(Object.keys(authApi)).not.toContain("submitPasswordAccount");
  });
});
