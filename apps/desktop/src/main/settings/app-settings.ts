import { readFileSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Schema } from "effect";
import { app } from "electron";

import {
  AppSettings as AppSettingsSchema,
  DEFAULT_APP_SETTINGS,
} from "../../shared/ipc/app";
import type { AppSettings } from "../../shared/ipc/app";

const APP_SETTINGS_FILENAME = "app-settings.json";
const APP_SETTINGS_WRITE_DEBOUNCE_MS = 250;

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
let pendingWrite: NodeJS.Timeout | undefined;
let writeQueue = Promise.resolve();

const persistAppSettings = Effect.fn("persistAppSettings")(
  (appSettingsPath: string, settings: AppSettings) =>
    Effect.tryPromise({
      catch: () => null,
      try: async () => {
        const temporaryPath = `${appSettingsPath}.tmp`;
        await mkdir(app.getPath("userData"), { recursive: true });
        try {
          await writeFile(
            temporaryPath,
            `${JSON.stringify(settings, null, 2)}\n`
          );
          await rename(temporaryPath, appSettingsPath);
        } finally {
          await rm(temporaryPath, { force: true });
        }
      },
    })
);

const persistCachedAppSettings = (): void => {
  pendingWrite = undefined;
  const settings = cachedSettings;
  const previousWrite = writeQueue;
  writeQueue = (async () => {
    await previousWrite;
    await Effect.runPromise(
      persistAppSettings(getAppSettingsPath(), settings).pipe(Effect.ignore)
    );
  })();
};

/** Loads persisted app settings into memory, falling back to defaults. */
export const hydrateAppSettings = (): void => {
  cachedSettings = Effect.runSync(loadAppSettings(getAppSettingsPath()));
};

/** Updates memory immediately and coalesces persistence on a short debounce. */
export const writeAppSettings = (next: AppSettings): void => {
  cachedSettings = next;

  if (pendingWrite !== undefined) {
    clearTimeout(pendingWrite);
  }

  pendingWrite = setTimeout(
    persistCachedAppSettings,
    APP_SETTINGS_WRITE_DEBOUNCE_MS
  );
  pendingWrite.unref();
};

/** Persists a pending update before orderly application shutdown. */
export const flushAppSettings = async (): Promise<void> => {
  if (pendingWrite !== undefined) {
    clearTimeout(pendingWrite);
    persistCachedAppSettings();
  }

  await writeQueue;
};

/** Current settings for hot paths such as window close handling. */
export const getCurrentAppSettings = (): AppSettings => cachedSettings;
