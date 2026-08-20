import * as Schema from "effect/Schema";

import { IpcReply } from "./reply";

export const AppClosingEvent = Schema.Literal("closing");

export const AppSettings = Schema.Struct({
  /** Whether renderer motion and CSS transitions are enabled. */
  animationsEnabled: Schema.Boolean,
  /** Whether mailbox thread selections open in native windows by default. */
  openThreadsInNewWindows: Schema.Boolean,
  /** Whether closing the main window keeps Kisa running in the tray. */
  runInBackground: Schema.Boolean,
});
export type AppSettings = typeof AppSettings.Type;

/** Apps without stored settings behave as if they had these settings. */
export const DEFAULT_APP_SETTINGS = {
  animationsEnabled: true,
  openThreadsInNewWindows: false,
  runInBackground: true,
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
  Schema.Struct({ appSettings: AppSettings, ok: Schema.Literal(true) }),
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

export const AppSettingsUpdateRequest = AppSettings;
export type AppSettingsUpdateRequest = typeof AppSettingsUpdateRequest.Type;

export const AppSettingsReply = IpcReply(AppSettings);
export type AppSettingsReply = typeof AppSettingsReply.Type;
