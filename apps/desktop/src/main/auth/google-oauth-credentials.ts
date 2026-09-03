import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Effect, Schema } from "effect";
import { app, dialog, safeStorage } from "electron";

const GOOGLE_OAUTH_CREDENTIALS_MAX_BYTES = 64 * 1024;
const ENCRYPTED_GOOGLE_OAUTH_CREDENTIALS_MAX_BYTES = 128 * 1024;
const GOOGLE_OAUTH_CREDENTIALS_FILENAME = "google-oauth-client.bin";

const GoogleDesktopOAuthFile = Schema.Struct({
  installed: Schema.Struct({
    client_id: Schema.NonEmptyString,
    client_secret: Schema.optional(Schema.NonEmptyString),
  }),
});
const StoredGoogleOAuthCredentials = Schema.Struct({
  clientId: Schema.NonEmptyString,
  clientSecret: Schema.optional(Schema.NonEmptyString),
});

export interface GoogleOAuthCredentials {
  readonly clientId: string;
  readonly clientSecret?: string;
}

// oxlint-disable-next-line unicorn/throw-new-error
class GoogleOAuthCredentialsError extends Schema.TaggedError<GoogleOAuthCredentialsError>()(
  "GoogleOAuthCredentialsError",
  { message: Schema.String }
) {}

const decodeGoogleDesktopOAuthFile = Schema.decodeUnknownEffect(
  Schema.fromJsonString(GoogleDesktopOAuthFile)
);
const decodeStoredGoogleOAuthCredentials = Schema.decodeUnknownEffect(
  Schema.fromJsonString(StoredGoogleOAuthCredentials)
);

const getStoredGoogleOAuthCredentialsPath = (): string =>
  path.join(app.getPath("userData"), GOOGLE_OAUTH_CREDENTIALS_FILENAME);

const invalidGoogleOAuthFile = (): GoogleOAuthCredentialsError =>
  new GoogleOAuthCredentialsError({
    message:
      "Choose the Desktop OAuth credentials JSON downloaded from Google Cloud",
  });

const unavailableStoredGoogleOAuthCredentials = () =>
  new GoogleOAuthCredentialsError({
    message: "Stored Google OAuth credentials are unavailable",
  });

const saveGoogleOAuthCredentialsError = () =>
  new GoogleOAuthCredentialsError({
    message: "Could not securely save Google OAuth credentials",
  });

const parseGoogleOAuthCredentials = Effect.fn("parseGoogleOAuthCredentials")(
  function* parseGoogleOAuthCredentials(raw: string) {
    const { installed } = yield* decodeGoogleDesktopOAuthFile(raw).pipe(
      Effect.mapError(invalidGoogleOAuthFile)
    );
    const clientId = installed.client_id.trim();
    const clientSecret = installed.client_secret?.trim();

    if (
      !clientId.endsWith(".apps.googleusercontent.com") ||
      clientId.length > 512 ||
      clientSecret?.length === 0 ||
      (clientSecret?.length ?? 0) > 512
    ) {
      return yield* invalidGoogleOAuthFile();
    }

    return { clientId, clientSecret } satisfies GoogleOAuthCredentials;
  }
);

export const chooseGoogleOAuthCredentials = Effect.fn(
  "chooseGoogleOAuthCredentials"
)(function* chooseGoogleOAuthCredentials() {
  const selection = yield* Effect.tryPromise({
    catch: () =>
      new GoogleOAuthCredentialsError({
        message: "Could not choose Google OAuth credentials",
      }),
    try: () =>
      dialog.showOpenDialog({
        filters: [{ extensions: ["json"], name: "Google OAuth credentials" }],
        properties: ["openFile"],
        title: "Choose Google Desktop OAuth credentials",
      }),
  });
  const filePath = selection.canceled ? undefined : selection.filePaths[0];

  if (filePath === undefined) {
    return;
  }

  const raw = yield* Effect.tryPromise({
    catch: invalidGoogleOAuthFile,
    try: async () => {
      const fileInfo = await stat(filePath);

      if (
        !fileInfo.isFile() ||
        fileInfo.size > GOOGLE_OAUTH_CREDENTIALS_MAX_BYTES
      ) {
        throw new Error("invalid Google OAuth credentials file");
      }

      return readFile(filePath, "utf-8");
    },
  });

  return yield* parseGoogleOAuthCredentials(raw);
});

export const loadStoredGoogleOAuthCredentials = Effect.fn(
  "loadStoredGoogleOAuthCredentials"
)(() =>
  Effect.gen(function* loadStoredCredentials() {
    const credentialsPath = getStoredGoogleOAuthCredentialsPath();
    const fileInfo = yield* Effect.tryPromise({
      catch: unavailableStoredGoogleOAuthCredentials,
      try: () => stat(credentialsPath),
    });

    if (
      !fileInfo.isFile() ||
      fileInfo.size > ENCRYPTED_GOOGLE_OAUTH_CREDENTIALS_MAX_BYTES
    ) {
      return yield* unavailableStoredGoogleOAuthCredentials();
    }

    const encrypted = yield* Effect.tryPromise({
      catch: unavailableStoredGoogleOAuthCredentials,
      try: () => readFile(credentialsPath),
    });
    const decrypted = yield* Effect.try({
      catch: unavailableStoredGoogleOAuthCredentials,
      try: () => safeStorage.decryptString(encrypted),
    });

    return yield* decodeStoredGoogleOAuthCredentials(decrypted).pipe(
      Effect.mapError(unavailableStoredGoogleOAuthCredentials)
    );
  }).pipe(Effect.orElseSucceed(() => null))
);

export const persistGoogleOAuthCredentials = Effect.fn(
  "persistGoogleOAuthCredentials"
)(function* persistGoogleOAuthCredentials(oauth: GoogleOAuthCredentials) {
  const prepared = yield* Effect.try({
    catch: saveGoogleOAuthCredentialsError,
    try: () => {
      const userDataPath = app.getPath("userData");
      const credentialsPath = path.join(
        userDataPath,
        GOOGLE_OAUTH_CREDENTIALS_FILENAME
      );

      return {
        credentialsPath,
        encrypted: safeStorage.encryptString(JSON.stringify(oauth)),
        temporaryPath: `${credentialsPath}.${randomUUID()}.tmp`,
        userDataPath,
      };
    },
  });

  yield* Effect.tryPromise({
    catch: saveGoogleOAuthCredentialsError,
    try: async () => {
      await mkdir(prepared.userDataPath, { recursive: true });
      await writeFile(prepared.temporaryPath, prepared.encrypted, {
        mode: 0o600,
      });
      await rename(prepared.temporaryPath, prepared.credentialsPath);
    },
  }).pipe(
    Effect.ensuring(
      Effect.tryPromise({
        catch: saveGoogleOAuthCredentialsError,
        try: () => rm(prepared.temporaryPath, { force: true }),
      }).pipe(Effect.ignore)
    ),
    Effect.uninterruptible
  );
});

export const createGoogleTokenRequestBody = (
  oauth: GoogleOAuthCredentials,
  values: Readonly<Record<string, string>>
): URLSearchParams => {
  const body = new URLSearchParams(values);
  body.set("client_id", oauth.clientId);

  if (oauth.clientSecret !== undefined) {
    body.set("client_secret", oauth.clientSecret);
  }

  return body;
};
