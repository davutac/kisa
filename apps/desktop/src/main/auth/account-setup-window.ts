import path from "node:path";

import { is } from "@electron-toolkit/utils";
import { AccountId } from "@repo/mail/ids";
import { Effect, Layer } from "effect";
import { app } from "electron";
import type { BrowserWindow } from "electron";

import { APP_NAME } from "@/constants";
import { TITLEBAR_HEIGHT } from "@/shared/window-chrome";

import { ACCOUNT_SETUP_HELP_URLS } from "../../shared/mail-account-presets";
import { openExternalUrl } from "../electron/shell";
import { toIpcReply } from "../ipc/reply";
import { ImapFlowConnectorLive } from "../mail/engine/imap-session";
import { MailDatabaseLive } from "../mail/engine/mail-database-live";
import { SmtpSignInLive } from "../mail/engine/smtp-sign-in";
import { createBrowserWindow } from "../window/browser-window";
import { getMainWindow } from "../window/create-window";
import { installNativeContextMenu } from "../window/native-context-menu";
import { listAccounts, notifyAccountsChanged } from "./accounts";
import {
  findHostedMailProvider,
  MailExchangeLookupLive,
} from "./mail-domain-lookup";
import {
  decodeMicrosoftAccountRequest,
  MICROSOFT_ACCOUNT_MESSAGES,
  MicrosoftAccountError,
  saveMicrosoftAccount,
  verifyMicrosoftAccount,
} from "./microsoft-account";
import { isMicrosoftSignInAvailable } from "./microsoft-client";
import {
  decodePasswordAccountRequest,
  findAccountSignIn,
  PASSWORD_ACCOUNT_MESSAGES,
  PasswordAccountError,
  savePasswordAccount,
  savePasswordSignInAgain,
  verifyPasswordAccount,
  verifyPasswordSignInAgain,
} from "./password-account";
import type { AccountSignInMethod } from "./password-account";

const SETUP_WINDOW_SIZE = { height: 600, width: 440 } as const;

const PasswordAccountLive = Layer.mergeAll(
  MailDatabaseLive,
  ImapFlowConnectorLive,
  SmtpSignInLive
);

/** The connected account a setup window signs in again, and how. */
interface SignInAgainTarget {
  readonly accountId: string;
  /** The address as stored, which the page shows. */
  readonly email: string;
  readonly method: AccountSignInMethod;
}

const SIGN_IN_ELSEWHERE = "This window signs in to another account.";

interface SetupSession {
  /** Stops a Microsoft sign-in that is waiting for the browser, if one is. */
  cancelMicrosoftSignIn: (() => void) | undefined;
  /** Settles when the window closes, to stop a verification in progress. */
  readonly closed: Promise<undefined>;
  /**
   * Set when the window signs a connected account in again. Main decides it
   * when the window opens, and every submission must name that account.
   */
  readonly signInAgain: SignInAgainTarget | undefined;
  submitting: boolean;
  readonly window: BrowserWindow;
}

let session: SetupSession | undefined;

const focusWindow = (window: BrowserWindow): void => {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
};

/**
 * How the page lays itself out: a macOS sheet has no title bar, while a
 * window keeps a strip for the window controls.
 */
type SetupPresentation = "sheet" | "window";

/** Whether this build carries a Microsoft client, so the page can offer it. */
const microsoftAvailability = (): "available" | "unavailable" =>
  isMicrosoftSignInAvailable() ? "available" : "unavailable";

/**
 * What the page is told in its URL: how it is shown, whether Microsoft is
 * available, and for signing in again, the account's address and how it
 * signs in. The address is not a secret; the sign-in itself never goes here.
 */
const setupQuery = (
  presentation: SetupPresentation,
  target: SignInAgainTarget | undefined
): (readonly [string, string])[] => {
  const query: (readonly [string, string])[] = [
    ["microsoft", microsoftAvailability()],
    ["presentation", presentation],
  ];
  if (target !== undefined) {
    query.push(["account", target.email], ["method", target.method]);
  }
  return query;
};

const loadSetupRenderer = (
  window: BrowserWindow,
  presentation: SetupPresentation,
  target: SignInAgainTarget | undefined
): Promise<void> => {
  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  const query = setupQuery(presentation, target);

  if (is.dev && rendererUrl !== undefined) {
    const url = new URL(rendererUrl);
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/account-setup.html`;
    for (const [name, value] of query) {
      url.searchParams.set(name, value);
    }
    return window.loadURL(url.toString());
  }

  return window.loadFile(
    path.join(import.meta.dirname, "../renderer/account-setup.html"),
    { query: Object.fromEntries(query) }
  );
};

/** Opens the setup window for a new account, or to sign one in again. */
const openSetupWindow = Effect.fn("openSetupWindow")(function* openSetupWindow(
  target: SignInAgainTarget | undefined
) {
  if (session !== undefined && !session.window.isDestroyed()) {
    // The open window serves this request, or is busy signing in. Otherwise
    // it was opened for something else, and gives way to this one.
    if (
      session.submitting ||
      session.signInAgain?.accountId === target?.accountId
    ) {
      focusWindow(session.window);
      return;
    }
    session.window.close();
  }

  const parent = getMainWindow();
  if (parent !== undefined) {
    focusWindow(parent);
    if (process.platform === "darwin") {
      // The sheet slides out below Kisa's own title bar.
      parent.setSheetOffset(TITLEBAR_HEIGHT);
    }
  }
  const presentation: SetupPresentation =
    parent !== undefined && process.platform === "darwin" ? "sheet" : "window";

  const window = createBrowserWindow({
    ...SETUP_WINDOW_SIZE,
    minHeight: SETUP_WINDOW_SIZE.height,
    minWidth: SETUP_WINDOW_SIZE.width,
    modalTo: parent,
    preload: path.join(import.meta.dirname, "../preload/account-setup.cjs"),
    title: `${target === undefined ? "Add account" : "Sign in again"} — ${APP_NAME}`,
  });
  window.setResizable(false);
  window.setMaximizable(false);
  window.setFullScreenable(false);

  const { promise: closed, resolve: markClosed } =
    Promise.withResolvers<undefined>();
  const current: SetupSession = {
    cancelMicrosoftSignIn: undefined,
    closed,
    signInAgain: target,
    submitting: false,
    window,
  };
  session = current;

  installNativeContextMenu(window);
  window.webContents.setWindowOpenHandler(({ url }) => {
    // The providers' help pages are the only links it may open.
    if (ACCOUNT_SETUP_HELP_URLS.has(url)) {
      openExternalUrl(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (details) => {
    if (!details.isMainFrame) {
      details.preventDefault();
    }
  });
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    markClosed(undefined);
    if (session === current) {
      session = undefined;
    }
  });

  yield* Effect.tryPromise({
    catch: () =>
      new PasswordAccountError({ message: "Could not open account setup" }),
    try: () => loadSetupRenderer(window, presentation, target),
  }).pipe(
    Effect.tapError(() =>
      Effect.sync(() => {
        if (!window.isDestroyed()) {
          window.destroy();
        }
      })
    )
  );
});

/**
 * Opens the Add account window, or focuses it when it is already open. It
 * is the only surface where a password is typed, so it never loads mail and
 * cannot navigate anywhere but its own page. Over the main window it is a
 * dialog (a sheet on macOS) yet still its own page, so the password never
 * enters the window that renders mail.
 */
export const openAccountSetupWindow = Effect.fn("openAccountSetupWindow")(
  function* openAccountSetupWindow() {
    yield* openSetupWindow(undefined);
  }
);

/**
 * Opens the same window to sign a connected account in again: an app
 * password account types a new password, and a Microsoft account signs in
 * in the browser. Main reads how the account signs in, so the page cannot
 * choose another account or another way.
 */
export const openAccountSignInWindow = Effect.fn("openAccountSignInWindow")(
  function* openAccountSignInWindow(email: string) {
    const target = yield* findAccountSignIn(email).pipe(
      Effect.provide(PasswordAccountLive),
      Effect.mapError(
        (error) =>
          new PasswordAccountError({
            message:
              error instanceof PasswordAccountError
                ? error.message
                : PASSWORD_ACCOUNT_MESSAGES.saveFailed,
          })
      )
    );
    yield* openSetupWindow(target);
  }
);

/** The session whose window sent this request, if it is still open. */
const sessionFor = (senderId: number | undefined): SetupSession | undefined =>
  session !== undefined &&
  !session.window.isDestroyed() &&
  session.window.webContents.id === senderId
    ? session
    : undefined;

const publishAccounts = Effect.gen(function* publishAccounts() {
  notifyAccountsChanged(
    yield* toIpcReply(listAccounts(), "Could not load accounts")
  );
});

/**
 * Handles the setup window's one submission at a time. Closing the window
 * stops a verification in progress; once the servers accepted the sign-in,
 * saving the account and announcing it runs to the end.
 */
export const submitAccountSetup = Effect.fn("submitAccountSetup")(
  function* submitAccountSetup(
    senderId: number | undefined,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Passed unread to the boundary decoder, which owns its contract.
    input: unknown
  ) {
    const current = sessionFor(senderId);

    if (current === undefined) {
      return yield* new PasswordAccountError({
        message: "Account setup is no longer open",
      });
    }
    if (current.submitting) {
      return yield* new PasswordAccountError({
        message: "Already signing in",
      });
    }

    const target = current.signInAgain;
    if (target?.method === "microsoft") {
      return yield* new PasswordAccountError({
        message: PASSWORD_ACCOUNT_MESSAGES.usesMicrosoft,
      });
    }

    current.submitting = true;
    yield* Effect.gen(function* signIn() {
      // A new account is verified from the request; signing in again, only
      // the password is taken from it, for the account the window was for.
      const save = yield* decodePasswordAccountRequest(input).pipe(
        Effect.flatMap((request) => {
          if (target === undefined) {
            return verifyPasswordAccount(request).pipe(
              Effect.map(savePasswordAccount)
            );
          }
          if (request.email.toLowerCase() !== target.accountId) {
            return Effect.fail(
              new PasswordAccountError({ message: SIGN_IN_ELSEWHERE })
            );
          }
          return verifyPasswordSignInAgain(
            AccountId.make(target.accountId),
            request.password
          ).pipe(Effect.map(savePasswordSignInAgain));
        }),
        Effect.provide(PasswordAccountLive),
        Effect.raceFirst(
          Effect.promise(() => current.closed).pipe(
            Effect.andThen(
              Effect.fail(
                new PasswordAccountError({
                  message: "Account setup was closed",
                })
              )
            )
          )
        )
      );

      yield* Effect.uninterruptible(
        save.pipe(
          Effect.provide(PasswordAccountLive),
          Effect.andThen(publishAccounts)
        )
      );
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          current.submitting = false;
        })
      )
    );

    const mainWindow = getMainWindow();
    if (mainWindow !== undefined) {
      focusWindow(mainWindow);
    }
    if (!current.window.isDestroyed()) {
      current.window.close();
    }
  }
);

/** Fails with `message` once `reason` settles: what ends a sign-in early. */
const stopped = (
  reason: Promise<undefined>,
  message: string
): Effect.Effect<never, MicrosoftAccountError> =>
  Effect.promise(() => reason).pipe(
    Effect.andThen(Effect.fail(new MicrosoftAccountError({ message })))
  );

/**
 * Adds a Microsoft account from the setup window: the browser sign-in, the
 * mailbox check, then the save. One runs at a time. Closing the window or
 * cancelling stops it while it waits for the browser or the servers, which
 * also closes the sign-in's listener; once the servers accepted the sign-in,
 * saving the account and announcing it runs to the end. No credential
 * crosses IPC here: the request carries an address, and the reply a fixed
 * message.
 */
export const startMicrosoftAccountSetup = Effect.fn(
  "startMicrosoftAccountSetup"
)(function* startMicrosoftAccountSetup(
  senderId: number | undefined,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Passed unread to the boundary decoder, which owns its contract.
  input: unknown
) {
  const current = sessionFor(senderId);

  if (current === undefined) {
    return yield* new MicrosoftAccountError({
      message: "Account setup is no longer open",
    });
  }
  if (current.submitting) {
    return yield* new MicrosoftAccountError({ message: "Already signing in" });
  }

  const target = current.signInAgain;
  if (target?.method === "password") {
    return yield* new MicrosoftAccountError({
      message: "This account signs in with a password.",
    });
  }

  const { promise: cancelled, resolve: cancel } =
    Promise.withResolvers<undefined>();
  current.submitting = true;
  current.cancelMicrosoftSignIn = () => cancel(undefined);

  yield* Effect.gen(function* signIn() {
    const verified = yield* decodeMicrosoftAccountRequest(input).pipe(
      Effect.flatMap((request) =>
        target === undefined || request.email.toLowerCase() === target.accountId
          ? verifyMicrosoftAccount(request)
          : Effect.fail(
              new MicrosoftAccountError({ message: SIGN_IN_ELSEWHERE })
            )
      ),
      Effect.provide(PasswordAccountLive),
      Effect.raceFirst(stopped(current.closed, "Account setup was closed")),
      Effect.raceFirst(stopped(cancelled, MICROSOFT_ACCOUNT_MESSAGES.cancelled))
    );

    yield* Effect.uninterruptible(
      saveMicrosoftAccount(verified).pipe(
        Effect.provide(PasswordAccountLive),
        Effect.andThen(publishAccounts)
      )
    );
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        current.submitting = false;
        current.cancelMicrosoftSignIn = undefined;
        // The user was last in the browser: Kisa comes forward to show what
        // became of the sign-in.
        app.focus({ steal: true });
      })
    )
  );

  const mainWindow = getMainWindow();
  if (mainWindow !== undefined) {
    focusWindow(mainWindow);
  }
  if (!current.window.isDestroyed()) {
    current.window.close();
  }
});

/**
 * Says who hosts a domain's mail, for the setup window alone: the window
 * asks before it decides whether to show server fields. The answer is a
 * fixed provider or `null`, never anything DNS returned.
 */
export const lookupAccountSetupDomain = Effect.fn("lookupAccountSetupDomain")(
  function* lookupAccountSetupDomain(
    senderId: number | undefined,
    domain: string
  ) {
    if (sessionFor(senderId) === undefined) {
      return yield* new PasswordAccountError({
        message: "Account setup is no longer open",
      });
    }
    const provider = yield* findHostedMailProvider(domain).pipe(
      Effect.provide(MailExchangeLookupLive)
    );
    return provider ?? null;
  }
);

/** Stops a Microsoft sign-in in progress, when the request came from the window. */
export const cancelMicrosoftAccountSetup = (
  senderId: number | undefined
): void => {
  sessionFor(senderId)?.cancelMicrosoftSignIn?.();
};

/** Closes the setup window, when the request came from it. */
export const closeAccountSetup = (senderId: number | undefined): void => {
  sessionFor(senderId)?.window.close();
};
