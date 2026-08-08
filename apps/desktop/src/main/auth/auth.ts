import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { googleAccounts } from "@repo/database/schemas";
import { eq as equals } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { app, BrowserWindow, safeStorage, shell } from "electron";

import {
  GOOGLE_AUTH_CALLBACK_URL,
  GOOGLE_AUTH_DEV_CALLBACK_URL,
} from "../../shared/app-protocol";
import type {
  GoogleAccount,
  GoogleAccountsReply,
  GoogleAuthCallback,
} from "../../shared/ipc/auth";
import { GoogleAccountsReply as GoogleAccountsReplySchema } from "../../shared/ipc/auth";
import { AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import { getDatabaseClient } from "../database";
import { sendRendererEvent } from "../electron/renderer-events";
import { toIpcReply } from "../ipc/reply";
import { notifyGoogleAccountConnected } from "./account-events";

const AUTH_WORKER_URL =
  process.env["AUTH_WORKER_URL"] ?? "https://kisa.davutcaliskan.de";
const GOOGLE_PROFILE_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_PROFILE_SCOPES = new Set([
  "profile",
  "https://www.googleapis.com/auth/userinfo.profile",
]);
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const GOOGLE_REQUEST_TIMEOUT_MS = 5000;

const AuthHandoff = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.Number),
  refreshToken: Schema.optional(Schema.NonEmptyString),
  scopes: Schema.Array(Schema.NonEmptyString),
});
const GmailProfile = Schema.Struct({ emailAddress: Schema.NonEmptyString });
const StoredCredentials = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.Number),
  refreshToken: Schema.optional(Schema.NonEmptyString),
});
const StoredScopes = Schema.Array(Schema.NonEmptyString);
const RefreshedCredentials = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.Number),
  refreshToken: Schema.optional(Schema.NonEmptyString),
});
const GoogleUserInfo = Schema.Struct({
  email: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
  picture: Schema.optional(Schema.NonEmptyString),
});

type AuthHandoff = typeof AuthHandoff.Type;

// oxlint-disable-next-line unicorn/throw-new-error
class GoogleAuthError extends Schema.TaggedErrorClass<GoogleAuthError>()(
  "GoogleAuthError",
  { message: Schema.String }
) {}

let pendingVerifier: string | undefined;
let callbackServer: Server | undefined;

const decodeHandoff = Schema.decodeUnknownPromise(AuthHandoff);
const decodeProfile = Schema.decodeUnknownPromise(GmailProfile);
const decodeStoredCredentials = Schema.decodeUnknownSync(StoredCredentials);
const decodeStoredScopes = Schema.decodeUnknownSync(StoredScopes);
const decodeRefreshedCredentials =
  Schema.decodeUnknownPromise(RefreshedCredentials);
const decodeGoogleUserInfo = Schema.decodeUnknownPromise(GoogleUserInfo);

export const notifyGoogleAccountsChanged = (
  reply: GoogleAccountsReply
): void => {
  sendRendererEvent(
    AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL,
    GoogleAccountsReplySchema,
    reply
  );
};

const focusAppWindow = (): void => {
  const [window] = BrowserWindow.getAllWindows();

  if (window === undefined || window.isDestroyed()) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  app.focus({ steal: true });
  window.focus();
};

const closeCallbackServer = (): void => {
  callbackServer?.close();
  callbackServer = undefined;
};

const requireSecureStorage = (): Effect.Effect<void, GoogleAuthError> =>
  Effect.try({
    catch: () =>
      new GoogleAuthError({ message: "Secure credential storage failed" }),
    try: () => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("encryption unavailable");
      }

      if (
        process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text"
      ) {
        throw new Error("insecure storage backend");
      }
    },
  }).pipe(
    Effect.mapError(
      () =>
        new GoogleAuthError({
          message:
            process.platform === "linux"
              ? "A secure Linux credential store is required for Google sign-in"
              : "Secure credential storage is unavailable on this device",
        })
    )
  );

const exchangeCode = Effect.fn("exchangeCode")(function* exchangeCode(
  code: string
) {
  const verifier = pendingVerifier;
  pendingVerifier = undefined;

  if (verifier === undefined) {
    return yield* new GoogleAuthError({
      message: "Google sign-in session expired. Please try again.",
    });
  }

  const response = yield* Effect.tryPromise({
    catch: () =>
      new GoogleAuthError({ message: "Could not complete Google sign-in" }),
    try: () =>
      fetch(new URL("/oauth/google/exchange", AUTH_WORKER_URL), {
        body: JSON.stringify({ code, codeVerifier: verifier }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
  });

  if (!response.ok) {
    return yield* new GoogleAuthError({
      message: `Google sign-in exchange failed (${response.status})`,
    });
  }

  return yield* Effect.tryPromise({
    catch: () => new GoogleAuthError({ message: "Invalid sign-in response" }),
    try: async () => decodeHandoff(await response.json()),
  });
});

const identifyAccount = Effect.fn("identifyAccount")(function* identifyAccount(
  handoff: AuthHandoff
) {
  const response = yield* Effect.tryPromise({
    catch: () =>
      new GoogleAuthError({ message: "Could not identify Google account" }),
    try: () =>
      fetch(GOOGLE_PROFILE_URL, {
        headers: { authorization: `Bearer ${handoff.accessToken}` },
      }),
  });

  if (!response.ok) {
    return yield* new GoogleAuthError({
      message: `Google account lookup failed (${response.status})`,
    });
  }

  return yield* Effect.tryPromise({
    catch: () => new GoogleAuthError({ message: "Invalid Google profile" }),
    try: async () => decodeProfile(await response.json()),
  });
});

const saveAuthorization = Effect.fn("saveAuthorization")(
  function* saveAuthorization(handoff: AuthHandoff) {
    yield* requireSecureStorage();
    const profile = yield* identifyAccount(handoff);
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAuthError({ message: error.message })
      )
    );
    const existing = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not load Google account" }),
      try: () =>
        database.query.googleAccounts
          .findFirst({
            columns: { credentials: true },
            where: (account, { eq }) => eq(account.email, profile.emailAddress),
          })
          .sync(),
    });
    const existingRefreshToken = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not read saved credentials" }),
      try: () => {
        if (existing === undefined) {
          return;
        }

        const credentials = decodeStoredCredentials(
          JSON.parse(safeStorage.decryptString(existing.credentials))
        );
        return credentials.refreshToken;
      },
    });
    const encryptedCredentials = safeStorage.encryptString(
      JSON.stringify({
        accessToken: handoff.accessToken,
        expiresAt: handoff.expiresAt,
        refreshToken: handoff.refreshToken ?? existingRefreshToken,
      })
    );
    const now = Date.now();

    yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not save Google account" }),
      try: () =>
        database
          .insert(googleAccounts)
          .values({
            createdAt: now,
            credentials: encryptedCredentials,
            email: profile.emailAddress,
            scopes: JSON.stringify(handoff.scopes),
            sortOrder: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: {
              credentials: encryptedCredentials,
              scopes: JSON.stringify(handoff.scopes),
              updatedAt: now,
            },
            target: googleAccounts.email,
          })
          .run(),
    });

    return profile.emailAddress;
  }
);

const refreshCredentials = Effect.fn("refreshCredentials")(
  function* refreshCredentials(credentials: typeof StoredCredentials.Type) {
    if (credentials.refreshToken === undefined) {
      return yield* new GoogleAuthError({
        message: "Google account must be connected again",
      });
    }

    const response = yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not refresh Google sign-in" }),
      try: () =>
        fetch(new URL("/oauth/google/refresh", AUTH_WORKER_URL), {
          body: JSON.stringify({ refreshToken: credentials.refreshToken }),
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
        }),
    });

    if (!response.ok) {
      return yield* new GoogleAuthError({
        message: "Google account must be connected again",
      });
    }

    const refreshed = yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Invalid token refresh response" }),
      try: async () => decodeRefreshedCredentials(await response.json()),
    });

    return {
      ...refreshed,
      refreshToken: refreshed.refreshToken ?? credentials.refreshToken,
    };
  }
);

export const getGoogleAccessToken = Effect.fn("getGoogleAccessToken")(
  function* getGoogleAccessToken(
    email: string,
    options: { readonly forceRefresh?: boolean } = {}
  ) {
    yield* requireSecureStorage();
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAuthError({ message: error.message })
      )
    );
    const account = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not load Google account" }),
      try: () =>
        database.query.googleAccounts
          .findFirst({
            where: (row, { eq }) => eq(row.email, email),
          })
          .sync(),
    });

    if (account === undefined) {
      return yield* new GoogleAuthError({
        message: "Google account is not connected",
      });
    }

    const stored = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not read saved credentials" }),
      try: () =>
        decodeStoredCredentials(
          JSON.parse(safeStorage.decryptString(account.credentials))
        ),
    });
    const shouldRefresh =
      options.forceRefresh === true ||
      (stored.expiresAt !== undefined &&
        stored.expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS);

    if (!shouldRefresh) {
      return stored.accessToken;
    }

    const refreshed = yield* refreshCredentials(stored);
    const encryptedCredentials = safeStorage.encryptString(
      JSON.stringify(refreshed)
    );

    yield* Effect.try({
      catch: () =>
        new GoogleAuthError({
          message: "Could not save refreshed credentials",
        }),
      try: () =>
        database
          .insert(googleAccounts)
          .values({
            ...account,
            credentials: encryptedCredentials,
            updatedAt: Date.now(),
          })
          .onConflictDoUpdate({
            set: {
              credentials: encryptedCredentials,
              updatedAt: Date.now(),
            },
            target: googleAccounts.email,
          })
          .run(),
    });

    return refreshed.accessToken;
  }
);

const AVATAR_MEDIA_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_AVATAR_BYTES = 512 * 1024;

interface CachedAvatar {
  readonly data: Buffer;
  readonly mediaType: string;
}

const NO_AVATAR: CachedAvatar | undefined = undefined;

/**
 * Avatars are downloaded once here rather than hotlinked from the renderer.
 * Google rate-limits its avatar CDN per session, and a burst of re-renders
 * turns into 429s that break every account's picture at once.
 */
const downloadAvatar = Effect.fn("downloadAvatar")(function* downloadAvatar(
  pictureUrl: string | undefined
) {
  if (pictureUrl === undefined || pictureUrl.length === 0) {
    return NO_AVATAR;
  }

  const response = yield* Effect.tryPromise({
    catch: () => new GoogleAuthError({ message: "Could not load avatar" }),
    try: () =>
      fetch(pictureUrl, {
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
      }),
  });

  if (!response.ok) {
    return NO_AVATAR;
  }

  const mediaType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim();

  if (mediaType === undefined || !AVATAR_MEDIA_TYPES.has(mediaType)) {
    return NO_AVATAR;
  }

  const bytes = yield* Effect.tryPromise({
    catch: () => new GoogleAuthError({ message: "Could not read avatar" }),
    try: async () => Buffer.from(await response.arrayBuffer()),
  });

  return bytes.byteLength > MAX_AVATAR_BYTES
    ? NO_AVATAR
    : ({ data: bytes, mediaType } satisfies CachedAvatar);
});

const toAvatarDataUrl = (
  data: Buffer | null,
  mediaType: string | null
): string | undefined =>
  data === null || mediaType === null
    ? undefined
    : `data:${mediaType};base64,${data.toString("base64")}`;

const loadGoogleUserInfo = Effect.fn("loadGoogleUserInfo")(
  function* loadGoogleUserInfo(accessToken: string) {
    const response = yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not load Google profile" }),
      try: () =>
        fetch(GOOGLE_USER_INFO_URL, {
          headers: { authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
        }),
    });

    if (!response.ok) {
      return yield* new GoogleAuthError({
        message: `Google profile lookup failed (${response.status})`,
      });
    }

    return yield* Effect.tryPromise({
      catch: () => new GoogleAuthError({ message: "Invalid Google profile" }),
      try: async () => decodeGoogleUserInfo(await response.json()),
    });
  }
);

const refreshAccountProfile = Effect.fn("refreshAccountProfile")(
  function* refreshAccountProfile(row: {
    readonly avatarData: Buffer | null;
    readonly avatarMediaType: string | null;
    readonly avatarUrl: string | null;
    readonly createdAt: number;
    readonly credentials: Buffer;
    readonly displayName: string | null;
    readonly email: string;
    readonly scopes: string;
    readonly sortOrder: number;
  }) {
    const scopes = decodeStoredScopes(JSON.parse(row.scopes));
    const cachedAvatar = toAvatarDataUrl(row.avatarData, row.avatarMediaType);
    const cached: GoogleAccount = {
      ...(cachedAvatar === undefined ? {} : { avatarUrl: cachedAvatar }),
      ...(row.displayName === null ? {} : { displayName: row.displayName }),
      email: row.email,
      scopes,
    };

    if (!scopes.some((scope) => GOOGLE_PROFILE_SCOPES.has(scope))) {
      return cached;
    }

    const stored = decodeStoredCredentials(
      JSON.parse(safeStorage.decryptString(row.credentials))
    );
    const credentials =
      stored.expiresAt !== undefined &&
      stored.expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS
        ? yield* refreshCredentials(stored)
        : stored;
    const profile = yield* loadGoogleUserInfo(credentials.accessToken);

    if (profile.email !== row.email) {
      return yield* new GoogleAuthError({
        message: "Google profile did not match the connected account",
      });
    }

    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAuthError({ message: error.message })
      )
    );
    const encryptedCredentials =
      credentials === stored
        ? row.credentials
        : safeStorage.encryptString(JSON.stringify(credentials));
    const now = Date.now();
    const avatar =
      row.avatarData !== null && row.avatarUrl === (profile.picture ?? null)
        ? undefined
        : yield* downloadAvatar(profile.picture).pipe(
            Effect.catch(() => Effect.succeed(NO_AVATAR))
          );

    yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not save Google profile" }),
      try: () =>
        database
          .insert(googleAccounts)
          .values({
            avatarData: avatar?.data ?? row.avatarData,
            avatarMediaType: avatar?.mediaType ?? row.avatarMediaType,
            avatarUrl: profile.picture,
            createdAt: row.createdAt,
            credentials: encryptedCredentials,
            displayName: profile.name,
            email: row.email,
            scopes: row.scopes,
            sortOrder: row.sortOrder,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            set: {
              avatarData: avatar?.data ?? row.avatarData,
              avatarMediaType: avatar?.mediaType ?? row.avatarMediaType,
              avatarUrl: profile.picture,
              credentials: encryptedCredentials,
              displayName: profile.name,
              updatedAt: now,
            },
            target: googleAccounts.email,
          })
          .run(),
    });

    const avatarUrl = toAvatarDataUrl(
      avatar?.data ?? row.avatarData,
      avatar?.mediaType ?? row.avatarMediaType
    );
    const displayName = profile.name ?? row.displayName ?? undefined;

    return {
      ...(avatarUrl === undefined ? {} : { avatarUrl }),
      ...(displayName === undefined ? {} : { displayName }),
      email: row.email,
      scopes,
    } satisfies GoogleAccount;
  }
);

export const listGoogleAccounts = Effect.fn("listGoogleAccounts")(
  function* listGoogleAccounts() {
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAuthError({ message: error.message })
      )
    );
    const rows = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not load Google accounts" }),
      try: () =>
        database.query.googleAccounts
          .findMany({
            columns: {
              avatarData: true,
              avatarMediaType: true,
              avatarUrl: true,
              createdAt: true,
              credentials: true,
              displayName: true,
              email: true,
              scopes: true,
              sortOrder: true,
            },
            orderBy: (account, { asc }) => [
              asc(account.sortOrder),
              asc(account.createdAt),
              asc(account.email),
            ],
          })
          .sync(),
    });

    return yield* Effect.forEach(
      rows,
      (row) =>
        refreshAccountProfile(row).pipe(
          Effect.catch(() =>
            Effect.succeed({
              ...(toAvatarDataUrl(row.avatarData, row.avatarMediaType) ===
              undefined
                ? {}
                : {
                    avatarUrl: toAvatarDataUrl(
                      row.avatarData,
                      row.avatarMediaType
                    ) as string,
                  }),
              ...(row.displayName === null
                ? {}
                : { displayName: row.displayName }),
              email: row.email,
              scopes: decodeStoredScopes(JSON.parse(row.scopes)),
            })
          )
        ),
      { concurrency: 4 }
    );
  }
);

export const reorderGoogleAccounts = Effect.fn("reorderGoogleAccounts")(
  function* reorderGoogleAccounts(emails: readonly string[]) {
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAuthError({ message: error.message })
      )
    );

    yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not save Google account order" }),
      try: () =>
        database.transaction((transaction) => {
          const storedEmails = new Set(
            transaction
              .select({ email: googleAccounts.email })
              .from(googleAccounts)
              .all()
              .map(({ email }) => email)
          );

          if (
            emails.length !== storedEmails.size ||
            !emails.every((email) => storedEmails.delete(email))
          ) {
            throw new Error("Account order did not match connected accounts");
          }

          for (const [sortOrder, email] of emails.entries()) {
            transaction
              .update(googleAccounts)
              .set({ sortOrder })
              .where(equals(googleAccounts.email, email))
              .run();
          }
        }),
    });
  }
);

const revokeStoredCredentials = Effect.fn("revokeStoredCredentials")(
  function* revokeStoredCredentials(email: string) {
    const database = yield* getDatabaseClient().pipe(
      Effect.mapError(
        (error) => new GoogleAuthError({ message: error.message })
      )
    );
    const account = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not load Google account" }),
      try: () =>
        database.query.googleAccounts
          .findFirst({
            columns: { credentials: true },
            where: (row, { eq }) => eq(row.email, email),
          })
          .sync(),
    });

    if (account === undefined) {
      return;
    }

    const stored = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not read saved credentials" }),
      try: () =>
        decodeStoredCredentials(
          JSON.parse(safeStorage.decryptString(account.credentials))
        ),
    });

    yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not revoke Google access" }),
      try: () =>
        fetch(GOOGLE_REVOKE_URL, {
          body: new URLSearchParams({
            token: stored.refreshToken ?? stored.accessToken,
          }).toString(),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
          signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
        }),
    });
  }
);

// Revoking is best effort: the account has to disappear from this device even
// when it is offline, or when Google already dropped the grant.
export const revokeGoogleAccountAccess = (email: string): Effect.Effect<void> =>
  revokeStoredCredentials(email).pipe(Effect.ignore);

export const handleGoogleAuthCallback = async (
  result: GoogleAuthCallback
): Promise<void> => {
  closeCallbackServer();
  focusAppWindow();

  if (result.error !== undefined) {
    pendingVerifier = undefined;
    notifyGoogleAccountsChanged({ error: result.error, ok: false });
    return;
  }

  try {
    const email = await Effect.runPromise(
      exchangeCode(result.code).pipe(Effect.flatMap(saveAuthorization))
    );

    // Reconnecting an already-indexed account is a no-op: the indexer ignores
    // the request once its state row reads `complete`.
    notifyGoogleAccountConnected(email);
    notifyGoogleAccountsChanged(
      await Effect.runPromise(
        toIpcReply(listGoogleAccounts(), "Google authentication failed")
      )
    );
  } catch (error) {
    notifyGoogleAccountsChanged({
      error:
        error instanceof Error ? error.message : "Google authentication failed",
      ok: false,
    });
  }
};

const startDevCallbackServer = (): Effect.Effect<void, GoogleAuthError> =>
  Effect.callback((resume) => {
    closeCallbackServer();

    const callbackUrl = new URL(GOOGLE_AUTH_DEV_CALLBACK_URL);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", callbackUrl);

      if (url.pathname !== callbackUrl.pathname) {
        response.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      let result: GoogleAuthCallback | undefined;

      if (error !== null) {
        result = { error };
      } else if (code !== null) {
        result = { code };
      }

      if (result === undefined) {
        response.writeHead(400).end("Invalid Google sign-in callback");
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("You can close this window and return to Kisa.");
      closeCallbackServer();
      void handleGoogleAuthCallback(result);
    });
    const handleListenError = (): void => {
      closeCallbackServer();
      resume(
        Effect.fail(
          new GoogleAuthError({
            message: "Could not start the local sign-in callback",
          })
        )
      );
    };

    callbackServer = server;
    server.once("error", handleListenError);
    server.listen(Number(callbackUrl.port), callbackUrl.hostname, () => {
      server.removeListener("error", handleListenError);
      server.on("error", closeCallbackServer);
      resume(Effect.void);
    });

    return Effect.sync(closeCallbackServer);
  });

export const startGoogleAuth = Effect.fn("startGoogleAuth")(
  function* startGoogleAuth() {
    yield* requireSecureStorage();

    if (pendingVerifier !== undefined) {
      return yield* new GoogleAuthError({
        message: "Google sign-in is already in progress",
      });
    }

    if (!app.isPackaged) {
      yield* startDevCallbackServer();
    }

    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("/oauth/google/start", AUTH_WORKER_URL);
    const callbackUrl = app.isPackaged
      ? GOOGLE_AUTH_CALLBACK_URL
      : GOOGLE_AUTH_DEV_CALLBACK_URL;
    url.search = new URLSearchParams({
      code_challenge: challenge,
      code_challenge_method: "S256",
      redirect_uri: callbackUrl,
    }).toString();
    pendingVerifier = verifier;

    yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not open Google sign-in" }),
      try: () => shell.openExternal(url.toString()),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          pendingVerifier = undefined;
          closeCallbackServer();
        })
      )
    );
  }
);
