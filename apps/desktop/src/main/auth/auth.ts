import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { googleAccounts } from "@repo/database/schemas";
import { GMAIL_FULL_ACCESS_SCOPE } from "@repo/gmail/models";
import { eq as equals } from "drizzle-orm";
import { Effect, Predicate, Schema } from "effect";
import { app, safeStorage, shell } from "electron";

import type { GoogleAccount, GoogleAccountsReply } from "../../shared/ipc/auth";
import { GoogleAccountsReply as GoogleAccountsReplySchema } from "../../shared/ipc/auth";
import { AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import {
  getLinuxSecretStorageErrorMessage,
  isSecureLinuxStorageBackend,
} from "../app/linux-secret-storage";
import { withDatabaseClient } from "../database-query";
import { sendRendererEvent } from "../electron/renderer-events";
import { toIpcReply } from "../ipc/reply";
import { getMainWindow } from "../window/create-window";
import { notifyGoogleAccountConnected } from "./account-events";
import { renderGoogleAuthCallbackPage } from "./google-auth-callback-page";
import type { GoogleOAuthCredentials } from "./google-oauth-credentials";
import {
  chooseGoogleOAuthCredentials,
  createGoogleTokenRequestBody,
  loadStoredGoogleOAuthCredentials,
  persistGoogleOAuthCredentials,
} from "./google-oauth-credentials";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_PROFILE_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USER_INFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_AUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  GMAIL_FULL_ACCESS_SCOPE,
] as const;
const GOOGLE_PROFILE_SCOPES = new Set([
  "profile",
  "https://www.googleapis.com/auth/userinfo.profile",
]);
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
const GOOGLE_REQUEST_TIMEOUT_MS = 5000;
const GOOGLE_TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const GOOGLE_AUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_CALLBACK_PATH = "/oauth/google/callback";
const GmailProfile = Schema.Struct({ emailAddress: Schema.NonEmptyString });
const StoredCredentials = Schema.Struct({
  accessToken: Schema.NonEmptyString,
  clientId: Schema.optional(Schema.NonEmptyString),
  clientSecret: Schema.optional(Schema.NonEmptyString),
  expiresAt: Schema.optional(Schema.Finite),
  oauthClient: Schema.optional(Schema.Literal("user-owned")),
  refreshToken: Schema.optional(Schema.NonEmptyString),
});
const StoredScopes = Schema.Array(Schema.NonEmptyString);
const GoogleTokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Finite,
  refresh_token: Schema.optional(Schema.NonEmptyString),
  scope: Schema.NonEmptyString,
  token_type: Schema.NonEmptyString,
});
const GoogleRefreshResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.Finite,
  refresh_token: Schema.optional(Schema.NonEmptyString),
  scope: Schema.optional(Schema.NonEmptyString),
  token_type: Schema.NonEmptyString,
});
const GoogleOAuthErrorResponse = Schema.Struct({
  error: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/u)),
  error_description: Schema.optional(Schema.NonEmptyString),
});
const GoogleUserInfo = Schema.Struct({
  email: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
  picture: Schema.optional(Schema.NonEmptyString),
});

interface AuthHandoff {
  readonly accessToken: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly scopes: readonly string[];
}

// oxlint-disable-next-line unicorn/throw-new-error
class GoogleAuthError extends Schema.TaggedError<GoogleAuthError>()(
  "GoogleAuthError",
  { message: Schema.String }
) {}

interface PendingGoogleAuthAttempt {
  readonly createdAt: number;
  readonly oauth: GoogleOAuthCredentials;
  readonly redirectUri: string;
  readonly server: Server;
  readonly timeout: NodeJS.Timeout;
  readonly verifier: string;
}

const pendingGoogleAuthAttempts = new Map<string, PendingGoogleAuthAttempt>();

const decodeProfile = Schema.decodeUnknownPromise(GmailProfile);
const decodeStoredCredentials = Schema.decodeUnknownSync(StoredCredentials);
const decodeStoredScopes = Schema.decodeUnknownSync(StoredScopes);
const decodeGoogleTokenResponse =
  Schema.decodeUnknownPromise(GoogleTokenResponse);
const decodeGoogleRefreshResponse = Schema.decodeUnknownPromise(
  GoogleRefreshResponse
);
const decodeGoogleOAuthErrorResponse = Schema.decodeUnknownPromise(
  GoogleOAuthErrorResponse
);
const decodeGoogleUserInfo = Schema.decodeUnknownPromise(GoogleUserInfo);

const isUserOwnedOAuthClient = (credentials: Buffer): boolean => {
  try {
    const stored = decodeStoredCredentials(
      JSON.parse(safeStorage.decryptString(credentials))
    );
    return stored.oauthClient === "user-owned";
  } catch {
    return false;
  }
};

const describeGoogleOAuthFailure = Effect.fn("describeGoogleOAuthFailure")(
  function* describeGoogleOAuthFailure(response: Response, prefix: string) {
    const payload = yield* Effect.promise(async () => {
      try {
        return await decodeGoogleOAuthErrorResponse(await response.json());
      } catch {
        return null;
      }
    });

    if (payload === null) {
      return `${prefix} (${response.status})`;
    }

    const description = payload.error_description;
    const safeDescription =
      description === "client_secret is missing." ? `: ${description}` : "";

    return `${prefix} (${response.status}, ${payload.error})${safeDescription}`;
  }
);

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
  const window = getMainWindow();

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

const closeServer = (server: Server): void => {
  if (server.listening) {
    server.close();
  }
};

const disposeGoogleAuthAttempt = (state: string): void => {
  const pending = pendingGoogleAuthAttempts.get(state);

  if (pending === undefined) {
    return;
  }

  pendingGoogleAuthAttempts.delete(state);
  clearTimeout(pending.timeout);
  closeServer(pending.server);
};

const pruneExpiredGoogleAuthAttempts = (now = Date.now()): void => {
  for (const [state, pending] of pendingGoogleAuthAttempts) {
    if (now - pending.createdAt >= GOOGLE_AUTH_ATTEMPT_TTL_MS) {
      disposeGoogleAuthAttempt(state);
    }
  }
};

const takePendingGoogleAuthAttempt = (
  state: string
): PendingGoogleAuthAttempt | undefined => {
  pruneExpiredGoogleAuthAttempts();
  const pending = pendingGoogleAuthAttempts.get(state);

  if (pending !== undefined) {
    disposeGoogleAuthAttempt(state);
  }

  return pending;
};

export const stopGoogleAuth = (): void => {
  for (const state of pendingGoogleAuthAttempts.keys()) {
    disposeGoogleAuthAttempt(state);
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
        !isSecureLinuxStorageBackend(safeStorage.getSelectedStorageBackend())
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
              ? getLinuxSecretStorageErrorMessage(
                  process.env["XDG_CURRENT_DESKTOP"]
                )
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

const exchangeCode = Effect.fn("exchangeCode")(function* exchangeCode(
  code: string,
  pending: PendingGoogleAuthAttempt
) {
  const { oauth } = pending;
  const response = yield* Effect.tryPromise({
    catch: () =>
      new GoogleAuthError({ message: "Could not complete Google sign-in" }),
    try: () =>
      fetch(GOOGLE_TOKEN_URL, {
        body: createGoogleTokenRequestBody(oauth, {
          code,
          code_verifier: pending.verifier,
          grant_type: "authorization_code",
          redirect_uri: pending.redirectUri,
        }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(GOOGLE_TOKEN_REQUEST_TIMEOUT_MS),
      }),
  });

  if (!response.ok) {
    const message = yield* describeGoogleOAuthFailure(
      response,
      "Google sign-in exchange failed"
    );
    return yield* new GoogleAuthError({
      message,
    });
  }

  const payload = yield* Effect.tryPromise({
    catch: () => new GoogleAuthError({ message: "Invalid sign-in response" }),
    try: async () => decodeGoogleTokenResponse(await response.json()),
  });

  return {
    accessToken: payload.access_token,
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret,
    expiresAt: Date.now() + payload.expires_in * 1000,
    refreshToken: payload.refresh_token,
    scopes: payload.scope.split(" ").filter((scope) => scope.length > 0),
  } satisfies AuthHandoff;
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
    const existingOAuthState = yield* Effect.try({
      catch: () =>
        new GoogleAuthError({ message: "Could not read saved credentials" }),
      try: () => {
        if (existing === undefined) {
          return;
        }

        const credentials = decodeStoredCredentials(
          JSON.parse(safeStorage.decryptString(existing.credentials))
        );
        return credentials.clientId === handoff.clientId
          ? {
              clientSecret: credentials.clientSecret,
              refreshToken: credentials.refreshToken,
            }
          : undefined;
      },
    });
    const encryptedCredentials = safeStorage.encryptString(
      JSON.stringify({
        accessToken: handoff.accessToken,
        clientId: handoff.clientId,
        clientSecret: handoff.clientSecret ?? existingOAuthState?.clientSecret,
        expiresAt: handoff.expiresAt,
        oauthClient: "user-owned",
        refreshToken: handoff.refreshToken ?? existingOAuthState?.refreshToken,
      })
    );
    const now = Date.now();

    yield* withDatabase("Could not save Google account", (database) =>
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
        .run()
    );

    return profile.emailAddress;
  }
);

const refreshCredentials = Effect.fn("refreshCredentials")(
  function* refreshCredentials(credentials: typeof StoredCredentials.Type) {
    const { clientId, clientSecret, oauthClient, refreshToken } = credentials;

    if (
      refreshToken === undefined ||
      clientId === undefined ||
      oauthClient !== "user-owned"
    ) {
      return yield* new GoogleAuthError({
        message:
          "Google account must be connected again with your own credentials JSON",
      });
    }
    const oauth = {
      clientId,
      clientSecret,
    };
    const response = yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not refresh Google sign-in" }),
      try: () =>
        fetch(GOOGLE_TOKEN_URL, {
          body: createGoogleTokenRequestBody(oauth, {
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
          signal: AbortSignal.timeout(GOOGLE_TOKEN_REQUEST_TIMEOUT_MS),
        }),
    });

    if (!response.ok) {
      const message = yield* describeGoogleOAuthFailure(
        response,
        "Google token refresh failed"
      );
      return yield* new GoogleAuthError({
        message,
      });
    }

    const refreshed = yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Invalid token refresh response" }),
      try: async () => decodeGoogleRefreshResponse(await response.json()),
    });

    return {
      accessToken: refreshed.access_token,
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      oauthClient: "user-owned" as const,
      refreshToken: refreshed.refresh_token ?? refreshToken,
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
    if (stored.oauthClient !== "user-owned") {
      return yield* new GoogleAuthError({
        message:
          "Google account must be connected again with your own credentials JSON",
      });
    }
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
      avatarUrl: cachedAvatar,
      displayName: row.displayName ?? undefined,
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
      avatarUrl,
      displayName,
      email: row.email,
      scopes,
    } satisfies GoogleAccount;
  }
);

export const listGoogleAccounts = Effect.fn("listGoogleAccounts")(
  function* listGoogleAccounts() {
    yield* requireSecureStorage();
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

    const userOwnedRows = rows.filter((row) =>
      isUserOwnedOAuthClient(row.credentials)
    );

    return yield* Effect.forEach(
      userOwnedRows,
      (row) => {
        const avatarUrl = toAvatarDataUrl(row.avatarData, row.avatarMediaType);

        return refreshAccountProfile(row).pipe(
          Effect.orElseSucceed(() => ({
            avatarUrl,
            displayName: row.displayName ?? undefined,
            email: row.email,
            scopes: decodeStoredScopes(JSON.parse(row.scopes)),
          }))
        );
      },
      { concurrency: 4 }
    );
  }
);

export const reorderGoogleAccounts = Effect.fn("reorderGoogleAccounts")(
  function* reorderGoogleAccounts(emails: readonly string[]) {
    yield* requireSecureStorage();
    const matchesStoredAccounts = yield* withDatabase(
      "Could not save Google account order",
      (database) =>
        database.transaction(async (transaction) => {
          const accountRows = await transaction
            .select({
              credentials: googleAccounts.credentials,
              email: googleAccounts.email,
            })
            .from(googleAccounts)
            .all();
          const storedEmails = new Set(
            accountRows
              .filter(({ credentials }) => isUserOwnedOAuthClient(credentials))
              .map(({ email }) => email)
          );

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

type GoogleAuthCallback =
  | {
      readonly code: string;
      readonly error?: never;
      readonly state: string;
    }
  | {
      readonly code?: never;
      readonly error: string;
      readonly state: string;
    };

export const handleGoogleAuthCallback = async (
  result: GoogleAuthCallback
): Promise<void> => {
  focusAppWindow();
  const pending = takePendingGoogleAuthAttempt(result.state);

  if (pending === undefined) {
    notifyGoogleAccountsChanged({
      error: "Google sign-in session expired. Please try again.",
      ok: false,
    });
    return;
  }

  if (result.error !== undefined) {
    notifyGoogleAccountsChanged({
      error:
        result.error === "access_denied"
          ? "Google sign-in was canceled."
          : "Google sign-in failed. Please try again.",
      ok: false,
    });
    return;
  }

  try {
    const email = await Effect.runPromise(
      exchangeCode(result.code, pending).pipe(Effect.flatMap(saveAuthorization))
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

const startCallbackServer = (
  state: string,
  verifier: string,
  oauth: GoogleOAuthCredentials
): Effect.Effect<string, GoogleAuthError> =>
  Effect.callback((resume) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (
        request.method !== "GET" ||
        url.pathname !== GOOGLE_AUTH_CALLBACK_PATH
      ) {
        response.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const callbackState = url.searchParams.get("state");
      let result: GoogleAuthCallback | undefined;

      if (callbackState !== state) {
        response.writeHead(400).end("Invalid Google sign-in state");
        return;
      }

      if (error !== null && error.length > 0) {
        result = { error, state };
      } else if (code !== null && code.length > 0) {
        result = { code, state };
      }

      if (result === undefined) {
        response.writeHead(400).end("Invalid Google sign-in callback");
        return;
      }

      response.writeHead(200, {
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        "content-type": "text/html; charset=utf-8",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      });
      response.end(renderGoogleAuthCallbackPage(result.error));
      void handleGoogleAuthCallback(result);
    });
    const handleListenError = (): void => {
      closeServer(server);
      resume(
        Effect.fail(
          new GoogleAuthError({
            message: "Could not start the local sign-in callback",
          })
        )
      );
    };

    server.once("error", handleListenError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", handleListenError);
      const address = server.address();

      if (address === null || Predicate.isString(address)) {
        closeServer(server);
        resume(
          Effect.fail(
            new GoogleAuthError({
              message: "Could not start the local sign-in callback",
            })
          )
        );
        return;
      }

      const redirectUri = `http://127.0.0.1:${address.port}${GOOGLE_AUTH_CALLBACK_PATH}`;
      const timeout = setTimeout(
        () => disposeGoogleAuthAttempt(state),
        GOOGLE_AUTH_ATTEMPT_TTL_MS
      );
      timeout.unref();
      pruneExpiredGoogleAuthAttempts();
      pendingGoogleAuthAttempts.set(state, {
        createdAt: Date.now(),
        oauth,
        redirectUri,
        server,
        timeout,
        verifier,
      });
      server.on("error", () => disposeGoogleAuthAttempt(state));
      server.unref();
      resume(Effect.succeed(redirectUri));
    });

    return Effect.sync(() => closeServer(server));
  });

export const startGoogleAuth = Effect.fn("startGoogleAuth")(
  function* startGoogleAuth() {
    yield* requireSecureStorage();
    const oauth = yield* loadStoredGoogleOAuthCredentials();

    if (oauth === null) {
      return yield* new GoogleAuthError({
        message: "Set up Google before signing in",
      });
    }

    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    const callbackUrl = yield* startCallbackServer(state, verifier, oauth);
    const url = new URL(GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      access_type: "offline",
      client_id: oauth.clientId,
      code_challenge: challenge,
      code_challenge_method: "S256",
      include_granted_scopes: "true",
      prompt: "consent",
      redirect_uri: callbackUrl,
      response_type: "code",
      scope: GOOGLE_AUTH_SCOPES.join(" "),
      state,
    }).toString();

    yield* Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Could not open Google sign-in" }),
      try: () => shell.openExternal(url.toString()),
    }).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          disposeGoogleAuthAttempt(state);
        })
      )
    );
  }
);

export const getGoogleOAuthClientStatus = Effect.fn(
  "getGoogleOAuthClientStatus"
)(function* getGoogleOAuthClientStatus() {
  yield* requireSecureStorage();
  return (yield* loadStoredGoogleOAuthCredentials()) !== null;
});

export const setupGoogleOAuthClient = Effect.fn("setupGoogleOAuthClient")(
  function* setupGoogleOAuthClient() {
    yield* requireSecureStorage();
    const oauth = yield* chooseGoogleOAuthCredentials();

    if (oauth === undefined) {
      return false;
    }

    yield* persistGoogleOAuthCredentials(oauth);
    return true;
  }
);
