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
  saveMicrosoftAccount,
  verifyMicrosoftAccount,
} from "../src/main/auth/microsoft-account";
import type {
  findAccountSignIn,
  savePasswordAccount,
  savePasswordSignInAgain,
  verifyPasswordAccount,
  verifyPasswordSignInAgain,
} from "../src/main/auth/password-account";
import * as DesktopIpc from "../src/main/ipc/desktop-ipc";
import type { AccountSetupBridge } from "../src/shared/ipc/account-setup";
import type { AccountsReply } from "../src/shared/ipc/accounts";
import {
  ACCOUNT_SETUP_CLOSE_CHANNEL,
  ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL,
  ACCOUNT_SETUP_MICROSOFT_CHANNEL,
  ACCOUNT_SETUP_SUBMIT_CHANNEL,
  ACCOUNTS_OPEN_SETUP_CHANNEL,
  ACCOUNTS_OPEN_SIGN_IN_CHANNEL,
} from "../src/shared/ipc/channels";
import { ACCOUNT_SETUP_HELP_URLS } from "../src/shared/mail-account-presets";

type Listener = (...args: unknown[]) => void;

/** What a window-open handler tells Electron to do with the new window. */
interface WindowOpenAnswer {
  readonly action: "allow" | "deny";
}

class FakeWindow {
  closed = false;
  readonly focus = vi.fn<() => void>();
  readonly handlers = new Map<string, Listener[]>();
  readonly loadFile = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly loadURL = vi.fn<() => Promise<void>>(() => Promise.resolve());
  readonly options: { readonly modalTo?: unknown; readonly preload?: string };
  readonly restore = vi.fn<() => void>();
  readonly setFullScreenable = vi.fn<(value: boolean) => void>();
  readonly setMaximizable = vi.fn<(value: boolean) => void>();
  readonly setResizable = vi.fn<(value: boolean) => void>();
  readonly show = vi.fn<() => void>();
  readonly webContents: {
    readonly handlers: Map<string, Listener[]>;
    readonly id: number;
    openHandler?: (details: { readonly url: string }) => WindowOpenAnswer;
    readonly on: (event: string, listener: Listener) => void;
    readonly setWindowOpenHandler: (
      handler: (details: { readonly url: string }) => WindowOpenAnswer
    ) => void;
  };

  constructor(
    id: number,
    options: { readonly modalTo?: unknown; readonly preload?: string }
  ) {
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

// SAFETY: each assertion in this object only widens an empty starting value,
// `[]` or `undefined`, to the type the tests fill it with.
const mocks = vi.hoisted(() => ({
  exposed: new Map<string, AccountSetupBridge>(),
  findSignIn: vi.fn<typeof findAccountSignIn>(),
  saveAgain: vi.fn<typeof savePasswordSignInAgain>(),
  verifyAgain: vi.fn<typeof verifyPasswordSignInAgain>(),
  invoke: vi.fn<typeof Electron.ipcRenderer.invoke>(() => Promise.resolve()),
  mainWindow: undefined as
    | {
        readonly focus: () => void;
        readonly isMinimized: () => boolean;
        readonly restore: () => void;
        readonly setSheetOffset: (offset: number) => void;
        readonly show: () => void;
      }
    | undefined,
  nextWindowId: 40,
  notifyAccountsChanged: vi.fn<(reply: AccountsReply) => void>(),
  openExternalUrl: vi.fn<(url: string) => boolean>(() => true),
  appFocus: vi.fn<() => void>(),
  demoMode: false,
  microsoftAvailable: true,
  save: vi.fn<typeof savePasswordAccount>(),
  saveMicrosoft: vi.fn<typeof saveMicrosoftAccount>(),
  verify: vi.fn<typeof verifyPasswordAccount>(),
  verifyMicrosoft: vi.fn<typeof verifyMicrosoftAccount>(),
  windows: [] as FakeWindow[],
}));

vi.mock("electron", () => ({
  app: { focus: mocks.appFocus },
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

// SAFETY: a failing call would show any BrowserWindow member the setup window
// uses that FakeWindow lacks, so the fake stands in for the window it types.
vi.mock(import("../src/main/window/browser-window"), () => ({
  createBrowserWindow: ((options: { readonly preload?: string }) => {
    mocks.nextWindowId += 1;
    const window = new FakeWindow(mocks.nextWindowId, options);
    mocks.windows.push(window);

    return window;
  }) as never,
}));

// SAFETY: `mocks.mainWindow` declares the window members the setup window
// calls on the main window; a missing one would fail as a call of `undefined`.
vi.mock(import("../src/main/window/create-window"), () => ({
  getMainWindow: (() => mocks.mainWindow) as never,
}));

vi.mock(import("../src/main/electron/shell"), () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock(import("../src/main/auth/accounts"), async () => {
  const { Effect: MockEffect } = await import("effect");

  // SAFETY: the setup window only passes the listed accounts, in a reply, to
  // the mocked `notifyAccountsChanged`, where these tests compare them.
  return {
    listAccounts: (() =>
      MockEffect.succeed([{ email: "name@icloud.com" }])) as never,
    notifyAccountsChanged: mocks.notifyAccountsChanged,
  };
});

// Disconnecting reaches the mail engine and the database utility process.
// SAFETY: no test here disconnects, so the stand-in only keeps the real
// module from loading and its type is never relied on.
vi.mock(import("../src/main/auth/disconnect-account"), () => ({
  disconnectAccount: vi.fn<() => never>() as never,
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
    findAccountSignIn: mocks.findSignIn,
    savePasswordAccount: mocks.save,
    savePasswordSignInAgain: mocks.saveAgain,
    verifyPasswordAccount: mocks.verify,
    verifyPasswordSignInAgain: mocks.verifyAgain,
  })
);

vi.mock(
  import("../src/main/auth/microsoft-account"),
  async (importOriginal) => ({
    ...(await importOriginal()),
    saveMicrosoftAccount: mocks.saveMicrosoft,
    verifyMicrosoftAccount: mocks.verifyMicrosoft,
  })
);

// Demo mode is fixed at launch; here each test chooses it.
vi.mock(import("../src/main/demo/demo-mode"), async (importOriginal) => ({
  ...(await importOriginal()),
  get isDemoMode() {
    return mocks.demoMode;
  },
}));

// The real module reaches for Electron's network stack and shell.
vi.mock(import("../src/main/auth/microsoft-client"), () => ({
  getMicrosoftOAuthEnvironment: () => {},
  isMicrosoftSignInAvailable: () => mocks.microsoftAvailable,
}));

const {
  cancelMicrosoftAccountSignIn,
  closeAccountSetupWindow,
  signInMicrosoftAccount,
  submitPasswordAccount,
} = await import("../src/main/ipc/methods/account-setup");

const { MICROSOFT_ACCOUNT_MESSAGES } =
  await import("../src/main/auth/microsoft-account");

const { DEMO_MODE_REFUSAL } = await import("../src/main/demo/demo-mode");

const { openAccountSetup, openAccountSignIn } =
  await import("../src/main/ipc/methods/accounts");

const { PASSWORD_ACCOUNT_MESSAGES } =
  await import("../src/main/auth/password-account");

const PASSWORD = "abcd-efgh-ijkl-mnop";
const validRequest = { email: "name@icloud.com", password: PASSWORD };

const verified = {
  credentials: Buffer.from("sealed"),
  dialect: "generic" as const,
  plan: {
    accountId: AccountId.make("name@icloud.com"),
    displayName: undefined,
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
        yield* ipc.handle(openAccountSignIn);
        yield* ipc.handle(submitPasswordAccount);
        yield* ipc.handle(signInMicrosoftAccount);
        yield* ipc.handle(cancelMicrosoftAccountSignIn);
        yield* ipc.handle(closeAccountSetupWindow);
      })
    )
  );

  return listeners;
};

/** What a renderer could send: a request, or anything else. */
type SubmitPayload =
  | string
  | { readonly email: string; readonly name?: string }
  | { readonly email: string; readonly password: string };

const invoke = async (
  listeners: Map<string, DesktopIpc.DesktopIpcHandleListener>,
  channel: string,
  senderId: number,
  payload?: SubmitPayload
) =>
  // SAFETY: the account-setup methods read only `sender.id` from the event.
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

/** Opens the window to sign a connected account in again. */
const openSignInWindow = async (
  method: "microsoft" | "password" = "password",
  email = "name@icloud.com"
) => {
  mocks.findSignIn.mockReturnValue(
    Effect.succeed({ accountId: AccountId.make(email), email, method })
  );

  const reply = await Effect.runPromise(
    openAccountSignIn.handler({ email: email.toUpperCase() })
  );

  const window = mocks.windows.at(-1);

  if (window === undefined) {
    throw new Error(`no sign-in window: ${JSON.stringify(reply)}`);
  }

  return window;
};

describe("the Add account window", () => {
  beforeEach(() => {
    mocks.verify.mockReset();
    mocks.save.mockReset();
    mocks.verify.mockReturnValue(Effect.succeed(verified));
    mocks.save.mockReturnValue(Effect.succeed(verified.plan.accountId));
    mocks.verifyMicrosoft.mockReset();
    mocks.saveMicrosoft.mockReset();
    mocks.saveMicrosoft.mockReturnValue(
      Effect.succeed(AccountId.make("person@outlook.com"))
    );
    mocks.appFocus.mockClear();
    mocks.demoMode = false;
    mocks.microsoftAvailable = true;
    mocks.notifyAccountsChanged.mockClear();
    mocks.openExternalUrl.mockClear();
    mocks.mainWindow = {
      focus: vi.fn<() => void>(),
      isMinimized: () => false,
      restore: vi.fn<() => void>(),
      setSheetOffset: vi.fn<(offset: number) => void>(),
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

    expect(openAccountSetup.channel).toBe(ACCOUNTS_OPEN_SETUP_CHANNEL);
    expect(window.options.preload).toMatch(/account-setup\.cjs$/u);
    expect(window.setResizable).toHaveBeenCalledWith(false);
  });

  // The window signs in to real servers whatever the engine is given, and
  // without a window nothing can submit a password.
  it("opens no window in demo mode, to add an account or to sign in again", async () => {
    mocks.demoMode = true;
    mocks.findSignIn.mockReturnValue(
      Effect.succeed({
        accountId: AccountId.make("name@icloud.com"),
        email: "name@icloud.com",
        method: "password",
      })
    );

    const refusal = { error: DEMO_MODE_REFUSAL, ok: false };

    await expect(
      Effect.runPromise(openAccountSetup.handler(undefined))
    ).resolves.toStrictEqual(refusal);
    await expect(
      Effect.runPromise(openAccountSignIn.handler({ email: "name@icloud.com" }))
    ).resolves.toStrictEqual(refusal);
    expect(mocks.windows).toHaveLength(0);
  });

  it("opens as a dialog over the main window, a sheet on macOS", async () => {
    const window = await openWindow();

    expect(window.options.modalTo).toBe(mocks.mainWindow);
    expect(window.loadFile).toHaveBeenCalledWith(expect.any(String), {
      query: {
        microsoft: "available",
        presentation: process.platform === "darwin" ? "sheet" : "window",
      },
    });
  });

  it("tells the page when this build cannot sign in to Microsoft", async () => {
    mocks.microsoftAvailable = false;
    const window = await openWindow();

    expect(window.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        query: expect.objectContaining({ microsoft: "unavailable" }),
      })
    );
  });

  it("opens as a window of its own when there is no main window", async () => {
    mocks.mainWindow = undefined;
    const window = await openWindow();

    expect(window.options.modalTo).toBeUndefined();
    expect(window.loadFile).toHaveBeenCalledWith(expect.any(String), {
      query: { microsoft: "available", presentation: "window" },
    });
  });

  it("focuses the open window instead of opening another", async () => {
    const window = await openWindow();
    const reply = await Effect.runPromise(openAccountSetup.handler(undefined));

    expect(reply).toStrictEqual({ data: undefined, ok: true });
    expect(mocks.windows).toHaveLength(1);
    expect(window.focus).toHaveBeenCalledOnce();
  });

  it("opens only the providers' help pages, in the system browser, and never navigates", async () => {
    const window = await openWindow();
    const preventDefault = vi.fn<() => void>();

    for (const url of ACCOUNT_SETUP_HELP_URLS) {
      expect(window.webContents.openHandler?.({ url })).toStrictEqual({
        action: "deny",
      });
    }

    expect(
      window.webContents.openHandler?.({ url: "https://example.com/" })
    ).toStrictEqual({ action: "deny" });

    for (const listener of window.webContents.handlers.get("will-navigate") ??
      []) {
      listener({ preventDefault }, "https://example.com/");
    }

    expect(mocks.openExternalUrl.mock.calls).toStrictEqual(
      [...ACCOUNT_SETUP_HELP_URLS].map((url) => [url])
    );
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
      data: [{ email: "name@icloud.com" }],
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
    const verifying = Promise.withResolvers<null>();
    mocks.verify.mockReturnValue(
      Effect.sync(() => verifying.resolve(null)).pipe(
        Effect.andThen(Effect.never),
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

    await verifying.promise;

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

  describe("Microsoft sign-in", () => {
    const request = { email: "person@outlook.com", name: "Person" };

    const verifiedMicrosoft = {
      credentials: Buffer.from("sealed"),
      dialect: "generic" as const,
      plan: {
        accountId: AccountId.make("person@outlook.com"),
        displayName: "Person",
        email: "person@outlook.com",
        imap: {
          host: "outlook.office365.com",
          port: 993,
          security: "tls" as const,
        },
        smtp: {
          host: "smtp-mail.outlook.com",
          port: 587,
          security: "starttls" as const,
        },
        username: "person@outlook.com",
      },
      tokens: {
        accessToken: Redacted.make("access-token"),
        expiresAt: 0,
        refreshToken: Redacted.make("refresh-token"),
        signedInAs: "person@outlook.com",
      },
    };

    /** A sign-in that waits in the browser until the test lets it finish. */
    const waitingInBrowser = () => {
      const { promise, resolve } = Promise.withResolvers<undefined>();
      let interrupted = false;
      mocks.verifyMicrosoft.mockReturnValue(
        Effect.promise(() => promise).pipe(
          Effect.as(verifiedMicrosoft),
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            })
          )
        )
      );

      return {
        finish: () => resolve(undefined),
        wasInterrupted: () => interrupted,
      };
    };

    it("adds the account, announces it and closes, bringing Kisa forward", async () => {
      mocks.verifyMicrosoft.mockReturnValue(Effect.succeed(verifiedMicrosoft));
      const listeners = await installMethods();
      const window = await openWindow();

      const reply = await invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        request
      );

      expect({ closed: window.isDestroyed(), reply }).toStrictEqual({
        closed: true,
        reply: { data: undefined, ok: true },
      });
      expect(mocks.verifyMicrosoft).toHaveBeenCalledWith(request);
      expect(mocks.saveMicrosoft).toHaveBeenCalledWith(verifiedMicrosoft);
      expect(mocks.notifyAccountsChanged).toHaveBeenCalledOnce();
      expect(mocks.appFocus).toHaveBeenCalledWith({ steal: true });
    });

    it("refuses a request that does not come from the setup window", async () => {
      const listeners = await installMethods();
      await openWindow();

      const reply = await invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        1,
        request
      );

      expect(reply).toStrictEqual({
        error: "Account setup is no longer open",
        ok: false,
      });
      expect(mocks.verifyMicrosoft).not.toHaveBeenCalled();
    });

    it("answers a malformed request with one fixed message", async () => {
      const listeners = await installMethods();
      const window = await openWindow();

      const reply = await invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        "not a request"
      );

      expect(reply).toStrictEqual({
        error: MICROSOFT_ACCOUNT_MESSAGES.invalidRequest,
        ok: false,
      });
      expect(mocks.verifyMicrosoft).not.toHaveBeenCalled();
      expect(window.isDestroyed()).toBeFalsy();
    });

    it("passes on a failure's fixed message and keeps the window open", async () => {
      const { MicrosoftAccountError } =
        await import("../src/main/auth/microsoft-account");

      mocks.verifyMicrosoft.mockReturnValue(
        Effect.fail(
          new MicrosoftAccountError({
            message: MICROSOFT_ACCOUNT_MESSAGES.mailboxRefused,
          })
        )
      );
      const listeners = await installMethods();
      const window = await openWindow();

      const reply = await invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        request
      );

      expect(reply).toStrictEqual({
        error: MICROSOFT_ACCOUNT_MESSAGES.mailboxRefused,
        ok: false,
      });
      expect(mocks.saveMicrosoft).not.toHaveBeenCalled();
      expect(window.isDestroyed()).toBeFalsy();
    });

    it("stops waiting for the browser when the window cancels, and can start again", async () => {
      const browser = waitingInBrowser();
      const listeners = await installMethods();
      const window = await openWindow();

      const pending = invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        request
      );

      // A cancel from anywhere else changes nothing.
      await invoke(listeners, ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL, 1);
      const interruptedByStranger = browser.wasInterrupted();
      await invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL,
        window.webContents.id
      );

      await expect(pending).resolves.toStrictEqual({
        error: MICROSOFT_ACCOUNT_MESSAGES.cancelled,
        ok: false,
      });
      // Interrupting the sign-in is what closes its listener.
      expect({
        closed: window.isDestroyed(),
        interrupted: browser.wasInterrupted(),
        interruptedByStranger,
      }).toStrictEqual({
        closed: false,
        interrupted: true,
        interruptedByStranger: false,
      });
      expect(mocks.saveMicrosoft).not.toHaveBeenCalled();

      mocks.verifyMicrosoft.mockReturnValue(Effect.succeed(verifiedMicrosoft));
      await expect(
        invoke(
          listeners,
          ACCOUNT_SETUP_MICROSOFT_CHANNEL,
          window.webContents.id,
          request
        )
      ).resolves.toStrictEqual({ data: undefined, ok: true });
    });

    it("stops waiting for the browser when the window closes", async () => {
      const browser = waitingInBrowser();
      const listeners = await installMethods();
      const window = await openWindow();

      const pending = invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        request
      );

      window.close();

      await expect(pending).resolves.toStrictEqual({
        error: "Account setup was closed",
        ok: false,
      });
      expect(browser.wasInterrupted()).toBeTruthy();
      expect(mocks.saveMicrosoft).not.toHaveBeenCalled();
    });

    it("runs one sign-in at a time, password or Microsoft", async () => {
      waitingInBrowser();
      const listeners = await installMethods();
      const window = await openWindow();

      const pending = invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        request
      );

      const second = await invoke(
        listeners,
        ACCOUNT_SETUP_MICROSOFT_CHANNEL,
        window.webContents.id,
        request
      );

      const password = await invoke(
        listeners,
        ACCOUNT_SETUP_SUBMIT_CHANNEL,
        window.webContents.id,
        validRequest
      );

      expect([second, password]).toStrictEqual([
        { error: "Already signing in", ok: false },
        { error: "Already signing in", ok: false },
      ]);
      window.close();
      await pending;
    });
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

describe("the window that signs an account in again", () => {
  beforeEach(() => {
    mocks.findSignIn.mockReset();
    mocks.verify.mockReset();
    mocks.save.mockReset();
    mocks.verifyAgain.mockReset();
    mocks.saveAgain.mockReset();
    mocks.verifyMicrosoft.mockReset();
    mocks.verifyAgain.mockReturnValue(
      Effect.succeed({
        accountId: AccountId.make("name@icloud.com"),
        credentials: Buffer.from("sealed"),
      })
    );
    mocks.saveAgain.mockReturnValue(
      Effect.succeed(AccountId.make("name@icloud.com"))
    );
    mocks.notifyAccountsChanged.mockClear();
    mocks.microsoftAvailable = true;
    mocks.mainWindow = undefined;
  });

  afterEach(() => {
    for (const window of mocks.windows) {
      window.destroy();
    }

    mocks.windows.length = 0;
  });

  it("tells the page which account it signs in and how, as main read them", async () => {
    const window = await openSignInWindow();

    expect(openAccountSignIn.channel).toBe(ACCOUNTS_OPEN_SIGN_IN_CHANNEL);
    expect(mocks.findSignIn).toHaveBeenCalledWith("NAME@ICLOUD.COM");
    expect(window.loadFile).toHaveBeenCalledWith(expect.any(String), {
      query: {
        account: "name@icloud.com",
        method: "password",
        microsoft: "available",
        presentation: "window",
      },
    });
  });

  // Only the password is taken from the page: the account and its servers
  // are the ones main opened the window for.
  it("signs the account in again with only the password it sends", async () => {
    const listeners = await installMethods();
    const window = await openSignInWindow();

    // SAFETY: deliberately not a SubmitPayload. It carries `servers`, which a
    // sign-in-again request has no field for, as a renderer could send.
    const reply = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      {
        ...validRequest,
        servers: {
          imap: { host: "imap.elsewhere.example", port: 993, security: "tls" },
          smtp: { host: "smtp.elsewhere.example", port: 465, security: "tls" },
        },
      } as never
    );

    const [accountId, password] = mocks.verifyAgain.mock.calls[0] ?? [];

    expect(reply).toStrictEqual({ data: undefined, ok: true });
    expect({
      accountId,
      password: Redacted.isRedacted(password),
    }).toStrictEqual({ accountId: "name@icloud.com", password: true });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.saveAgain).toHaveBeenCalledOnce();
    expect(window.isDestroyed()).toBeTruthy();
  });

  it("refuses a submission for another account", async () => {
    const listeners = await installMethods();
    const window = await openSignInWindow();

    const reply = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      window.webContents.id,
      { email: "someone@icloud.com", password: PASSWORD }
    );

    expect(reply).toStrictEqual({
      error: "This window signs in to another account.",
      ok: false,
    });
    expect(mocks.verifyAgain).not.toHaveBeenCalled();
    expect(mocks.saveAgain).not.toHaveBeenCalled();
  });

  it("takes no password for an account that signs in with Microsoft, and no Microsoft sign-in for one with a password", async () => {
    const listeners = await installMethods();

    const microsoftWindow = await openSignInWindow(
      "microsoft",
      "person@outlook.com"
    );

    const passwordReply = await invoke(
      listeners,
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      microsoftWindow.webContents.id,
      { email: "person@outlook.com", password: PASSWORD }
    );

    const passwordWindow = await openSignInWindow();

    const microsoftReply = await invoke(
      listeners,
      ACCOUNT_SETUP_MICROSOFT_CHANNEL,
      passwordWindow.webContents.id,
      { email: "name@icloud.com" }
    );

    expect(passwordReply).toStrictEqual({
      error: PASSWORD_ACCOUNT_MESSAGES.usesMicrosoft,
      ok: false,
    });
    expect(microsoftReply).toStrictEqual({
      error: "This account signs in with a password.",
      ok: false,
    });
    expect(mocks.verifyAgain).not.toHaveBeenCalled();
    expect(mocks.verifyMicrosoft).not.toHaveBeenCalled();
  });

  it("signs a Microsoft account in again only for the account it was opened for", async () => {
    const listeners = await installMethods();

    const { MicrosoftAccountError } =
      await import("../src/main/auth/microsoft-account");

    mocks.verifyMicrosoft.mockReturnValue(
      Effect.fail(new MicrosoftAccountError({ message: "stopped here" }))
    );
    const window = await openSignInWindow("microsoft", "person@outlook.com");

    const elsewhere = await invoke(
      listeners,
      ACCOUNT_SETUP_MICROSOFT_CHANNEL,
      window.webContents.id,
      { email: "someone@outlook.com" }
    );

    const verifiedBefore = mocks.verifyMicrosoft.mock.calls.length;
    await invoke(
      listeners,
      ACCOUNT_SETUP_MICROSOFT_CHANNEL,
      window.webContents.id,
      { email: "Person@Outlook.com" }
    );

    expect(elsewhere).toStrictEqual({
      error: "This window signs in to another account.",
      ok: false,
    });
    expect(verifiedBefore).toBe(0);
    expect(mocks.verifyMicrosoft).toHaveBeenCalledWith({
      email: "Person@Outlook.com",
    });
  });

  it("takes the place of an Add account window that is not signing in", async () => {
    const addWindow = await openWindow();

    const signInWindow = await openSignInWindow();

    expect(addWindow.isDestroyed()).toBeTruthy();
    expect(signInWindow).not.toBe(addWindow);
    expect(signInWindow.isDestroyed()).toBeFalsy();
  });
});

describe("the account setup preloads", () => {
  beforeEach(() => {
    mocks.invoke.mockClear();
  });

  it("expose only the sign-ins, cancel and close, on the channels main listens on", async () => {
    await import("../src/preload/account-setup");
    const bridge = mocks.exposed.get("accountSetup");
    const microsoftRequest = { email: "person@outlook.com" };

    expect(Object.keys(bridge ?? {}).toSorted()).toStrictEqual([
      "cancelMicrosoftSignIn",
      "close",
      "signInWithMicrosoft",
      "submit",
    ]);
    await bridge?.submit(validRequest);
    await bridge?.signInWithMicrosoft(microsoftRequest);
    await bridge?.cancelMicrosoftSignIn();
    await bridge?.close();

    expect(mocks.invoke.mock.calls).toStrictEqual([
      [ACCOUNT_SETUP_SUBMIT_CHANNEL, validRequest],
      [ACCOUNT_SETUP_MICROSOFT_CHANNEL, microsoftRequest],
      [ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL],
      [ACCOUNT_SETUP_CLOSE_CHANNEL],
    ]);
    expect([
      submitPasswordAccount.channel,
      signInMicrosoftAccount.channel,
      cancelMicrosoftAccountSignIn.channel,
      closeAccountSetupWindow.channel,
    ]).toStrictEqual([
      ACCOUNT_SETUP_SUBMIT_CHANNEL,
      ACCOUNT_SETUP_MICROSOFT_CHANNEL,
      ACCOUNT_SETUP_MICROSOFT_CANCEL_CHANNEL,
      ACCOUNT_SETUP_CLOSE_CHANNEL,
    ]);
  });

  it("let the mail window open the setup window and nothing more", async () => {
    const { accountsApi } = await import("../src/preload/accounts-api");

    await accountsApi.openAccountSetup();
    await accountsApi.openAccountSignIn({ email: "name@icloud.com" });

    expect(mocks.invoke.mock.calls).toStrictEqual([
      [ACCOUNTS_OPEN_SETUP_CHANNEL],
      [ACCOUNTS_OPEN_SIGN_IN_CHANNEL, { email: "name@icloud.com" }],
    ]);
    expect(Object.keys(accountsApi)).not.toContain("submitPasswordAccount");
  });
});
