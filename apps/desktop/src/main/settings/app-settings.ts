import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Effect, Schema } from "effect";
import { app } from "electron";

import {
  AppSettings as AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
} from "../../shared/ipc/app";
import type { AppSettings } from "../../shared/ipc/app";

const APP_SETTINGS_FILENAME = "app-settings.json";

const getAppSettingsPath = (): string =>
  path.join(app.getPath("userData"), APP_SETTINGS_FILENAME);

const decodeAppSettings = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AppSettingsSchema)
);

// Total effect: unreadable or undecodable files fall back to the defaults.
const loadAppSettings = Effect.fn("loadAppSettings")(
  (appSettingsPath: string) =>
    Effect.try({
      catch: () => null,
      try: () => readFileSync(appSettingsPath, "utf-8"),
    }).pipe(
      Effect.flatMap((contents) =>
        decodeAppSettings(contents).pipe(
          Effect.orElseSucceed(() => DEFAULT_APP_SETTINGS)
        )
      ),
      Effect.orElseSucceed(() => DEFAULT_APP_SETTINGS)
    )
);

let cachedSettings: AppSettings = DEFAULT_APP_SETTINGS;

/** Loads persisted app settings into memory, falling back to defaults. */
export const hydrateAppSettings = (): void => {
  const appSettingsPath = getAppSettingsPath();

  if (existsSync(appSettingsPath)) {
    cachedSettings = Effect.runSync(loadAppSettings(appSettingsPath));
  }
};

/** Persists app settings best-effort and never blocks the caller. */
export const writeAppSettings = (next: AppSettings): void => {
  cachedSettings = next;
  Effect.runSync(
    Effect.try({
      catch: () => null,
      try: () => {
        mkdirSync(app.getPath("userData"), { recursive: true });
        writeFileSync(
          getAppSettingsPath(),
          `${JSON.stringify(next, null, 2)}\n`
        );
      },
    })
  );
};

/** Current settings for hot paths such as window close handling. */
export const getCurrentAppSettings = (): AppSettings => cachedSettings;
