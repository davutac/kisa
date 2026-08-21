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

const decodeGoogleDesktopOAuthFile = Schema.decodeUnknownSync(
  GoogleDesktopOAuthFile
);
const decodeStoredGoogleOAuthCredentials = Schema.decodeUnknownSync(
  StoredGoogleOAuthCredentials
);

const getStoredGoogleOAuthCredentialsPath = (): string =>
  path.join(app.getPath("userData"), GOOGLE_OAUTH_CREDENTIALS_FILENAME);

const invalidGoogleOAuthFile = (): GoogleOAuthCredentialsError =>
  new GoogleOAuthCredentialsError({
    message:
      "Choose the Desktop OAuth credentials JSON downloaded from Google Cloud",
  });

const parseGoogleOAuthCredentials = (
  raw: string
): Effect.Effect<GoogleOAuthCredentials, GoogleOAuthCredentialsError> =>
  Effect.try({
    catch: invalidGoogleOAuthFile,
    try: () => {
      const { installed } = decodeGoogleDesktopOAuthFile(JSON.parse(raw));
      const clientId = installed.client_id.trim();
      const clientSecret = installed.client_secret?.trim();

      if (
        !clientId.endsWith(".apps.googleusercontent.com") ||
        clientId.length > 512 ||
        clientSecret?.length === 0 ||
        (clientSecret?.length ?? 0) > 512
      ) {
        throw new Error("invalid Google Desktop OAuth credentials");
      }

      return { clientId, clientSecret };
    },
  });

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
  Effect.promise(async () => {
    try {
      const credentialsPath = getStoredGoogleOAuthCredentialsPath();
      const fileInfo = await stat(credentialsPath);

      if (
        !fileInfo.isFile() ||
        fileInfo.size > ENCRYPTED_GOOGLE_OAUTH_CREDENTIALS_MAX_BYTES
      ) {
        return null;
      }

      const encrypted = await readFile(credentialsPath);
      return decodeStoredGoogleOAuthCredentials(
        JSON.parse(safeStorage.decryptString(encrypted))
      );
    } catch {
      return null;
    }
  })
);

export const persistGoogleOAuthCredentials = Effect.fn(
  "persistGoogleOAuthCredentials"
)(function* persistGoogleOAuthCredentials(oauth: GoogleOAuthCredentials) {
  yield* Effect.tryPromise({
    catch: () =>
      new GoogleOAuthCredentialsError({
        message: "Could not securely save Google OAuth credentials",
      }),
    try: async () => {
      const userDataPath = app.getPath("userData");
      const credentialsPath = getStoredGoogleOAuthCredentialsPath();
      const temporaryPath = `${credentialsPath}.${randomUUID()}.tmp`;
      const encrypted = safeStorage.encryptString(JSON.stringify(oauth));

      await mkdir(userDataPath, { recursive: true });
      try {
        await writeFile(temporaryPath, encrypted, { mode: 0o600 });
        await rename(temporaryPath, credentialsPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
    },
  });
});

export const createGoogleTokenRequestBody = (
  oauth: GoogleOAuthCredentials,
  values: Readonly<Record<string, string>>
): URLSearchParams => {
  const body = new URLSearchParams({ client_id: oauth.clientId, ...values });

  if (oauth.clientSecret !== undefined) {
    body.set("client_secret", oauth.clientSecret);
  }

  return body;
};
