import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const AppClosingEvent = Schema.Literal("closing");

/** How long images kept from opened emails last unused; `null` is forever. */
export const InlineImageRetentionDays = Schema.NullOr(
  Schema.Literals([30, 90, 365])
);

export type InlineImageRetentionDays = typeof InlineImageRetentionDays.Type;

export const DEFAULT_INLINE_IMAGE_RETENTION_DAYS = 90;

/**
 * How long a sent message waits before it leaves, so Undo can take it back;
 * `0` sends at once.
 */
export const UndoSendSeconds = Schema.Literals([0, 5, 10, 20, 30]);

export type UndoSendSeconds = typeof UndoSendSeconds.Type;

export const DEFAULT_UNDO_SEND_SECONDS = 10;

export const AppSettings = Schema.Struct({
  /** Whether renderer motion and CSS transitions are enabled. */
  animationsEnabled: Schema.Boolean,
  // Settings files written before this setting existed keep their values.
  inlineImageRetentionDays: InlineImageRetentionDays.pipe(
    Schema.withDecodingDefaultKey(
      Effect.succeed(DEFAULT_INLINE_IMAGE_RETENTION_DAYS)
    )
  ),
  /** Whether mailbox thread selections open in native windows by default. */
  openThreadsInNewWindows: Schema.Boolean,
  /** Whether closing the main window keeps Kisa running in the tray. */
  runInBackground: Schema.Boolean,
  // Settings files written before this setting existed keep their values.
  undoSendSeconds: UndoSendSeconds.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(DEFAULT_UNDO_SEND_SECONDS))
  ),
});

export type AppSettings = typeof AppSettings.Type;

/** Apps without stored settings behave as if they had these settings. */
export const DEFAULT_APP_SETTINGS = {
  animationsEnabled: true,
  inlineImageRetentionDays: DEFAULT_INLINE_IMAGE_RETENTION_DAYS,
  openThreadsInNewWindows: false,
  runInBackground: true,
  undoSendSeconds: DEFAULT_UNDO_SEND_SECONDS,
} as const satisfies AppSettings;

export const LoginItemSettings = Schema.Struct({
  openAtLogin: Schema.Boolean,
  requiresApproval: Schema.Boolean,
});

export type LoginItemSettings = typeof LoginItemSettings.Type;

export const LoginItemSettingsUpdateRequest = Schema.Struct({
  openAtLogin: Schema.Boolean,
});

export type LoginItemSettingsUpdateRequest =
  typeof LoginItemSettingsUpdateRequest.Type;

export const LoginItemSettingsReply = IpcReply(LoginItemSettings);

export type LoginItemSettingsReply = typeof LoginItemSettingsReply.Type;

export const AppStartupErrorPayload = Schema.Struct({
  message: Schema.String,
  reason: Schema.optional(Schema.String),
  tag: Schema.optional(Schema.String),
});

export type AppStartupErrorPayload = typeof AppStartupErrorPayload.Type;

export const AppStartupReply = Schema.Union([
  Schema.Struct({
    appSettings: AppSettings,
    /**
     * Whether a database from before the mail engine is on disk, so the
     * sign-in screen says what did not carry over.
     */
    legacyDatabaseNotice: Schema.Boolean,
    ok: Schema.Literal(true),
  }),
  Schema.Struct({ error: AppStartupErrorPayload, ok: Schema.Literal(false) }),
]);

export type AppStartupReply = typeof AppStartupReply.Type;

export const ThreadWindowOpenRequest = Schema.Struct({
  accountId: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
});

export type ThreadWindowOpenRequest = typeof ThreadWindowOpenRequest.Type;

export const ThreadWindowOpenReply = IpcReply(Schema.Void);

export type ThreadWindowOpenReply = typeof ThreadWindowOpenReply.Type;

/**
 * The appearance the reader chose for the app. Main hands it to Electron, so
 * what follows the system's appearance by default follows the app's instead:
 * native menus and window chrome, and `prefers-color-scheme` in every frame,
 * a message's included.
 */
export const AppTheme = Schema.Literals(["dark", "light", "system"]);

export type AppTheme = typeof AppTheme.Type;

export const AppThemeRequest = Schema.Struct({ theme: AppTheme });

export type AppThemeRequest = typeof AppThemeRequest.Type;

export const AppThemeReply = IpcReply(Schema.Void);

export type AppThemeReply = typeof AppThemeReply.Type;

export const AppSettingsUpdateRequest = AppSettings;

export type AppSettingsUpdateRequest = typeof AppSettingsUpdateRequest.Type;

export const AppSettingsReply = IpcReply(AppSettings);

export type AppSettingsReply = typeof AppSettingsReply.Type;
