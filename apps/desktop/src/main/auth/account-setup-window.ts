import path from "node:path";

import { is } from "@electron-toolkit/utils";
import { Effect, Layer } from "effect";
import type { BrowserWindow } from "electron";

import { APP_NAME } from "@/constants";
import { TITLEBAR_HEIGHT } from "@/shared/window-chrome";

import { APP_PASSWORD_URLS } from "../../shared/mail-account-presets";
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
  decodePasswordAccountRequest,
  PasswordAccountError,
  savePasswordAccount,
  verifyPasswordAccount,
} from "./password-account";

const SETUP_WINDOW_SIZE = { height: 600, width: 440 } as const;

const PasswordAccountLive = Layer.mergeAll(
  MailDatabaseLive,
  ImapFlowConnectorLive,
  SmtpSignInLive
);

interface SetupSession {
  /** Settles when the window closes, to stop a verification in progress. */
  readonly closed: Promise<undefined>;
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

const loadSetupRenderer = (
  window: BrowserWindow,
  presentation: SetupPresentation
): Promise<void> => {
  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];

  if (is.dev && rendererUrl !== undefined) {
    const url = new URL(rendererUrl);
    url.pathname = `${url.pathname.replace(/\/$/u, "")}/account-setup.html`;
    url.searchParams.set("presentation", presentation);
    return window.loadURL(url.toString());
  }

  return window.loadFile(
    path.join(import.meta.dirname, "../renderer/account-setup.html"),
    { query: { presentation } }
  );
};

/**
 * Opens the Add account window, or focuses it when it is already open. It
 * is the only surface where a password is typed, so it never loads mail and
 * cannot navigate anywhere but its own page. Over the main window it is a
 * dialog (a sheet on macOS) yet still its own page, so the password never
 * enters the window that renders mail.
 */
export const openAccountSetupWindow = Effect.fn("openAccountSetupWindow")(
  function* openAccountSetupWindow() {
    if (session !== undefined && !session.window.isDestroyed()) {
      focusWindow(session.window);
      return;
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
      parent !== undefined && process.platform === "darwin"
        ? "sheet"
        : "window";

    const window = createBrowserWindow({
      ...SETUP_WINDOW_SIZE,
      minHeight: SETUP_WINDOW_SIZE.height,
      minWidth: SETUP_WINDOW_SIZE.width,
      modalTo: parent,
      preload: path.join(import.meta.dirname, "../preload/account-setup.cjs"),
      title: `Add account — ${APP_NAME}`,
    });
    window.setResizable(false);
    window.setMaximizable(false);
    window.setFullScreenable(false);

    const { promise: closed, resolve: markClosed } =
      Promise.withResolvers<undefined>();
    const current: SetupSession = { closed, submitting: false, window };
    session = current;

    installNativeContextMenu(window);
    window.webContents.setWindowOpenHandler(({ url }) => {
      // The providers' app password pages are the only links it may open.
      if (APP_PASSWORD_URLS.has(url)) {
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
      try: () => loadSetupRenderer(window, presentation),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (!window.isDestroyed()) {
            window.destroy();
          }
        })
      )
    );
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

    current.submitting = true;
    yield* Effect.gen(function* signIn() {
      const verified = yield* decodePasswordAccountRequest(input).pipe(
        Effect.flatMap(verifyPasswordAccount),
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
        savePasswordAccount(verified).pipe(
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

/** Closes the setup window, when the request came from it. */
export const closeAccountSetup = (senderId: number | undefined): void => {
  sessionFor(senderId)?.window.close();
};
