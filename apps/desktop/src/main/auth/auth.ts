import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { googleAccounts } from "@repo/database/schemas";
import { count, eq as equals } from "drizzle-orm";
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
import {
  GoogleAccountsReply as GoogleAccountsReplySchema,
  MAX_GOOGLE_ACCOUNTS,
} from "../../shared/ipc/auth";
import { AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import { withDatabaseClient } from "../database";
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
const GOOGLE_AUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GOOGLE_ACCOUNT_LIMIT_MESSAGE = `You can connect up to ${MAX_GOOGLE_ACCOUNTS} Google accounts.`;

const AuthHandoff = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.Finite),
  refreshToken: Schema.optional(Schema.NonEmptyString),
  scopes: Schema.Array(Schema.NonEmptyString),
});
const GmailProfile = Schema.Struct({ emailAddress: Schema.NonEmptyString });
const StoredCredentials = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.Finite),
  refreshToken: Schema.optional(Schema.NonEmptyString),
});
const StoredScopes = Schema.Array(Schema.NonEmptyString);
const RefreshedCredentials = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  expiresAt: Schema.optional(Schema.Finite),
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

interface PendingGoogleAuthAttempt {
  readonly createdAt: number;
  readonly verifier: string;
}

const pendingGoogleAuthAttempts = new Map<string, PendingGoogleAuthAttempt>();
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

const pruneExpiredGoogleAuthAttempts = (now = Date.now()): void => {
  for (const [attempt, pending] of pendingGoogleAuthAttempts) {
    if (now - pending.createdAt >= GOOGLE_AUTH_ATTEMPT_TTL_MS) {
      pendingGoogleAuthAttempts.delete(attempt);
    }
  }
};

const addPendingGoogleAuthAttempt = (
  attempt: string,
  verifier: string
): void => {
  const now = Date.now();
  pruneExpiredGoogleAuthAttempts(now);
  pendingGoogleAuthAttempts.set(attempt, {
    createdAt: now,
    verifier,
  });
};

const takePendingGoogleAuthVerifier = (attempt: string): string | undefined => {
  pruneExpiredGoogleAuthAttempts();
  const pending = pendingGoogleAuthAttempts.get(attempt);
  pendingGoogleAuthAttempts.delete(attempt);
  return pending?.verifier;
};

const closeCallbackServerIfIdle = (): void => {
  pruneExpiredGoogleAuthAttempts();
  if (pendingGoogleAuthAttempts.size === 0) {
    closeCallbackServer();
  }
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

const withDatabase = <A>(
  message: string,
  run: (database: RemoteDatabaseClient) => Promise<A>
): Effect.Effect<A, GoogleAuthError> =>
  withDatabaseClient(run).pipe(
    Effect.mapError(() => new GoogleAuthError({ message }))
  );

const requireGoogleAccountCapacity = Effect.fn("requireGoogleAccountCapacity")(
  function* requireGoogleAccountCapacity() {
    const accountCount = yield* withDatabase(
      "Could not load Google accounts",
      async (database) => {
        const rows = await database
          .select({ value: count() })
          .from(googleAccounts)
          .all();
        return rows.at(0)?.value ?? 0;
      }
    );

    if (accountCount >= MAX_GOOGLE_ACCOUNTS) {
      return yield* new GoogleAuthError({
        message: GOOGLE_ACCOUNT_LIMIT_MESSAGE,
      });
    }
  }
);

const exchangeCode = Effect.fn("exchangeCode")(function* exchangeCode(
  code: string,
  attempt: string
) {
  const verifier = takePendingGoogleAuthVerifier(attempt);

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
    const existing = yield* withDatabase(
      "Could not load Google account",
      (database) =>
        database.query.googleAccounts.findFirst({
          columns: { credentials: true },
          where: { email: profile.emailAddress },
        })
    );
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

    const saved = yield* withDatabase(
      "Could not save Google account",
      (database) =>
        database.transaction(async (transaction) => {
          const existingAccounts = await transaction
            .select({ email: googleAccounts.email })
            .from(googleAccounts)
            .where(equals(googleAccounts.email, profile.emailAddress))
            .all();
          const accountRows = await transaction
            .select({ value: count() })
            .from(googleAccounts)
            .all();
          const isExistingAccount = existingAccounts.length > 0;
          const accountCount = accountRows.at(0)?.value ?? 0;

          if (!isExistingAccount && accountCount >= MAX_GOOGLE_ACCOUNTS) {
            return false;
          }

          await transaction
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
            .run();
          return true;
        })
    );

    if (!saved) {
      return yield* new GoogleAuthError({
        message: GOOGLE_ACCOUNT_LIMIT_MESSAGE,
      });
    }

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
    const account = yield* withDatabase(
      "Could not load Google account",
      (database) =>
        database.query.googleAccounts.findFirst({
          where: { email },
        })
    );

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

    yield* withDatabase("Could not save refreshed credentials", (database) =>
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
        .run()
    );

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

    const encryptedCredentials =
      credentials === stored
        ? row.credentials
        : safeStorage.encryptString(JSON.stringify(credentials));
    const now = Date.now();
    const avatar =
      row.avatarData !== null && row.avatarUrl === (profile.picture ?? null)
        ? undefined
        : yield* downloadAvatar(profile.picture).pipe(
            Effect.orElseSucceed(() => NO_AVATAR)
          );

    yield* withDatabase("Could not save Google profile", (database) =>
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
        .run()
    );

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
    const rows = yield* withDatabase(
      "Could not load Google accounts",
      (database) =>
        database.query.googleAccounts.findMany({
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
          // SQL ordering follows insertion order, so these keys are semantic.
          // oxlint-disable-next-line eslint/sort-keys
          orderBy: {
            sortOrder: "asc",
            createdAt: "asc",
            email: "asc",
          },
        })
    );

    return yield* Effect.forEach(
      rows,
      (row) =>
        refreshAccountProfile(row).pipe(
          Effect.orElseSucceed(() => ({
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
          }))
        ),
      { concurrency: 4 }
    );
  }
);

export const reorderGoogleAccounts = Effect.fn("reorderGoogleAccounts")(
  function* reorderGoogleAccounts(emails: readonly string[]) {
    const matchesStoredAccounts = yield* withDatabase(
      "Could not save Google account order",
      (database) =>
        database.transaction(async (transaction) => {
          const accountRows = await transaction
            .select({ email: googleAccounts.email })
            .from(googleAccounts)
            .all();
          const storedEmails = new Set(accountRows.map(({ email }) => email));

          if (
            emails.length !== storedEmails.size ||
            !emails.every((email) => storedEmails.delete(email))
          ) {
            return false;
          }

          for (const [sortOrder, email] of emails.entries()) {
            // Account order updates must remain ordered within this transaction.
            // oxlint-disable-next-line eslint/no-await-in-loop
            await transaction
              .update(googleAccounts)
              .set({ sortOrder })
              .where(equals(googleAccounts.email, email))
              .run();
          }
          return true;
        })
    );

    if (!matchesStoredAccounts) {
      return yield* new GoogleAuthError({
        message: "Account order did not match connected accounts",
      });
    }
  }
);

const revokeStoredCredentials = Effect.fn("revokeStoredCredentials")(
  function* revokeStoredCredentials(email: string) {
    const account = yield* withDatabase(
      "Could not load Google account",
      (database) =>
        database.query.googleAccounts.findFirst({
          columns: { credentials: true },
          where: { email },
        })
    );

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
  focusAppWindow();

  if (result.error !== undefined) {
    pendingGoogleAuthAttempts.delete(result.attempt);
    closeCallbackServerIfIdle();
    notifyGoogleAccountsChanged({ error: result.error, ok: false });
    return;
  }

  try {
    const email = await Effect.runPromise(
      exchangeCode(result.code, result.attempt).pipe(
        Effect.flatMap(saveAuthorization)
      )
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
  } finally {
    closeCallbackServerIfIdle();
  }
};

const startDevCallbackServer = (): Effect.Effect<void, GoogleAuthError> => {
  if (callbackServer !== undefined) {
    return Effect.void;
  }

  return Effect.callback((resume) => {
    const callbackUrl = new URL(GOOGLE_AUTH_DEV_CALLBACK_URL);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", callbackUrl);

      if (url.pathname !== callbackUrl.pathname) {
        response.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const attempt = url.searchParams.get("attempt");
      let result: GoogleAuthCallback | undefined;

      if (attempt !== null && attempt.length > 0) {
        if (error !== null) {
          result = { attempt, error };
        } else if (code !== null) {
          result = { attempt, code };
        }
      }

      if (result === undefined) {
        response.writeHead(400).end("Invalid Google sign-in callback");
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("You can close this window and return to Kisa.");
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
};

export const startGoogleAuth = Effect.fn("startGoogleAuth")(
  function* startGoogleAuth() {
    yield* requireSecureStorage();
    yield* requireGoogleAccountCapacity();

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
    addPendingGoogleAuthAttempt(challenge, verifier);

    yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not open Google sign-in" }),
      try: () => shell.openExternal(url.toString()),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          pendingGoogleAuthAttempts.delete(challenge);
          closeCallbackServerIfIdle();
        })
      )
    );
  }
);
