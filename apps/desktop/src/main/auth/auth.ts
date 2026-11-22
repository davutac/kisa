import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import { mailAccounts } from "@repo/database/schemas";
import { eq as equals } from "drizzle-orm";
import { Effect, Option, Predicate, Schema } from "effect";
import { app, safeStorage, shell } from "electron";

import type { GoogleAccount, GoogleAccountsReply } from "../../shared/ipc/auth";
import { GoogleAccountsReply as GoogleAccountsReplySchema } from "../../shared/ipc/auth";
import { AUTH_GOOGLE_ACCOUNTS_CHANGED_CHANNEL } from "../../shared/ipc/channels";
import { withDatabaseClient } from "../database-query";
import { sendRendererEvent } from "../electron/renderer-events";
import { toIpcReply } from "../ipc/reply";
import { refreshUnreadBadge } from "../mail/unread-badge";
import { getMainWindow } from "../window/create-window";
import { notifyAccountConnected } from "./account-events";
import { requireSecureCredentialStorage } from "./credential-storage";
import type { StoredCredentials } from "./google-account-credentials";
import {
  decryptStoredCredentials,
  isUserOwnedOAuthClient,
} from "./google-account-credentials";
import { renderGoogleAuthCallbackPage } from "./google-auth-callback-page";
import type { GoogleOAuthCredentials } from "./google-oauth-credentials";
import {
  chooseGoogleOAuthCredentials,
  createGoogleTokenRequestBody,
  loadStoredGoogleOAuthCredentials,
  persistGoogleOAuthCredentials,
} from "./google-oauth-credentials";

/** Full mailbox access, which Gmail requires for IMAP and SMTP. */
const GMAIL_FULL_ACCESS_SCOPE = "https://mail.google.com/";
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
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
const GMAIL_SERVERS = {
  imapHost: "imap.gmail.com",
  imapPort: 993,
  imapSecurity: "tls",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecurity: "tls",
} as const;
const GOOGLE_REQUEST_TIMEOUT_MS = 5000;
const GOOGLE_TOKEN_REQUEST_TIMEOUT_MS = 10_000;
const GOOGLE_AUTH_ATTEMPT_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_CALLBACK_PATH = "/oauth/google/callback";
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
export class GoogleAuthError extends Schema.TaggedError<GoogleAuthError>()(
  "GoogleAuthError",
  {
    message: Schema.String,
    /** The grant is gone or unusable: only signing in again helps. */
    reauthorize: Schema.optional(Schema.Boolean),
  }
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

const decodeGoogleTokenResponse =
  Schema.decodeUnknownPromise(GoogleTokenResponse);
const decodeGoogleRefreshResponse = Schema.decodeUnknownPromise(
  GoogleRefreshResponse
);
const decodeGoogleOAuthErrorResponse = Schema.decodeUnknownEffect(
  GoogleOAuthErrorResponse
);
const decodeGoogleUserInfo = Schema.decodeUnknownPromise(GoogleUserInfo);

const readStoredCredentials = Effect.fn("readStoredCredentials")(
  (credentials: Buffer) =>
    Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({
          message: "Could not read saved credentials",
          reauthorize: true,
        }),
      try: () => decryptStoredCredentials(credentials),
    })
);

const encryptStoredCredentials = Effect.fn("encryptStoredCredentials")(
  (credentials: typeof StoredCredentials.Type) =>
    Effect.tryPromise({
      catch: () =>
        new GoogleAuthError({ message: "Secure credential storage failed" }),
      try: () => safeStorage.encryptStringAsync(JSON.stringify(credentials)),
    })
);

const describeGoogleOAuthFailure = Effect.fn("describeGoogleOAuthFailure")(
  function* describeGoogleOAuthFailure(response: Response, prefix: string) {
    const payload = yield* Effect.tryPromise(() => response.json()).pipe(
      Effect.flatMap(decodeGoogleOAuthErrorResponse),
      Effect.option
    );

    if (Option.isNone(payload)) {
      return `${prefix} (${response.status})`;
    }

    const description = payload.value.error_description;
    const safeDescription =
      description === "client_secret is missing." ? `: ${description}` : "";

    return `${prefix} (${response.status}, ${payload.value.error})${safeDescription}`;
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
  requireSecureCredentialStorage.pipe(
    Effect.mapError(({ message }) => new GoogleAuthError({ message }))
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
        reauthorize: true,
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
      // 400 and 401 mean a revoked or expired grant, or a deleted client;
      // anything else (a 5xx, a timeout) is worth retrying.
      return yield* new GoogleAuthError({
        message,
        reauthorize: response.status === 400 || response.status === 401,
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
      scopes: credentials.scopes,
    };
  }
);

export interface GoogleAccessGrant {
  readonly accessToken: string;
  /** Epoch milliseconds when the token stops working, when Google said. */
  readonly expiresAt?: number | undefined;
}

/**
 * A current access token for a Google account, refreshed (and saved) when it
 * is about to expire. The token stays in main; it is handed only to the
 * IMAP and SMTP connections that authenticate with it.
 */
export const getGoogleAccessGrant = Effect.fn("getGoogleAccessGrant")(
  function* getGoogleAccessGrant(
    accountId: string,
    options: { readonly forceRefresh?: boolean } = {}
  ) {
    yield* requireSecureStorage();
    const account = yield* withDatabase(
      "Could not load Google account",
      (database) =>
        database.query.mailAccounts.findFirst({
          columns: { authKind: true, credentials: true },
          where: { accountId },
        })
    );

    if (account?.authKind !== "google-oauth") {
      return yield* new GoogleAuthError({
        message: "Google account is not connected",
        reauthorize: true,
      });
    }

    const stored = yield* readStoredCredentials(account.credentials);
    if (stored.oauthClient !== "user-owned") {
      return yield* new GoogleAuthError({
        message:
          "Google account must be connected again with your own credentials JSON",
        reauthorize: true,
      });
    }
    const shouldRefresh =
      options.forceRefresh === true ||
      (stored.expiresAt !== undefined &&
        stored.expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS);

    if (!shouldRefresh) {
      return {
        accessToken: stored.accessToken,
        expiresAt: stored.expiresAt,
      } satisfies GoogleAccessGrant;
    }

    const refreshed = yield* refreshCredentials(stored);
    const encryptedCredentials = yield* encryptStoredCredentials(refreshed);

    yield* withDatabase("Could not save refreshed credentials", (database) =>
      database
        .update(mailAccounts)
        .set({ credentials: encryptedCredentials, updatedAt: Date.now() })
        .where(equals(mailAccounts.accountId, accountId))
        .run()
    );

    return {
      accessToken: refreshed.accessToken,
      expiresAt: refreshed.expiresAt,
    } satisfies GoogleAccessGrant;
  }
);

export const getGoogleAccessToken = Effect.fn("getGoogleAccessToken")(
  function* getGoogleAccessToken(
    accountId: string,
    options: { readonly forceRefresh?: boolean } = {}
  ) {
    return (yield* getGoogleAccessGrant(accountId, options)).accessToken;
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

/**
 * Saves a Google sign-in as a Gmail account read over IMAP. The account is
 * identified from OpenID userinfo, so connecting needs no Gmail REST call.
 */
const saveAuthorization = Effect.fn("saveAuthorization")(
  function* saveAuthorization(handoff: AuthHandoff) {
    yield* requireSecureStorage();
    const profile = yield* loadGoogleUserInfo(handoff.accessToken);
    const accountId = profile.email.toLowerCase();
    const existing = yield* withDatabase(
      "Could not load Google account",
      (database) =>
        database.query.mailAccounts.findFirst({
          columns: { authKind: true, credentials: true },
          where: { accountId },
        })
    );

    // The upsert below replaces only credentials, so it must never land on
    // an account that signs in with a password.
    if (existing !== undefined && existing.authKind !== "google-oauth") {
      return yield* new GoogleAuthError({
        message:
          "This address is already connected with a password. Disconnect it first.",
      });
    }

    const existingCredentials =
      existing === undefined
        ? undefined
        : yield* readStoredCredentials(existing.credentials).pipe(
            // A fresh refresh token can replace an unreadable saved grant.
            Effect.catchIf(
              () => handoff.refreshToken !== undefined,
              () => Effect.succeed(null)
            )
          );
    const existingOAuthState =
      existingCredentials?.clientId === handoff.clientId
        ? {
            clientSecret: existingCredentials.clientSecret,
            refreshToken: existingCredentials.refreshToken,
          }
        : undefined;
    const encryptedCredentials = yield* encryptStoredCredentials({
      accessToken: handoff.accessToken,
      clientId: handoff.clientId,
      clientSecret: handoff.clientSecret ?? existingOAuthState?.clientSecret,
      expiresAt: handoff.expiresAt,
      oauthClient: "user-owned",
      refreshToken: handoff.refreshToken ?? existingOAuthState?.refreshToken,
      scopes: handoff.scopes,
    });
    const avatar = yield* downloadAvatar(profile.picture).pipe(
      Effect.orElseSucceed(() => NO_AVATAR)
    );
    const now = Date.now();

    yield* withDatabase("Could not save Google account", (database) =>
      database
        .insert(mailAccounts)
        .values({
          ...GMAIL_SERVERS,
          accountId,
          authKind: "google-oauth",
          avatarData: avatar?.data ?? null,
          avatarMediaType: avatar?.mediaType ?? null,
          avatarUrl: profile.picture ?? null,
          createdAt: now,
          credentials: encryptedCredentials,
          dialect: "gmail",
          displayName: profile.name ?? null,
          email: profile.email,
          provider: "gmail",
          sortOrder: now,
          updatedAt: now,
          username: profile.email,
        })
        .onConflictDoUpdate({
          set: {
            credentials: encryptedCredentials,
            displayName: profile.name ?? null,
            updatedAt: now,
          },
          target: mailAccounts.accountId,
        })
        .run()
    );

    return accountId;
  }
);

interface StoredAccountRow {
  readonly accountId: string;
  readonly avatarData: Buffer | null;
  readonly avatarMediaType: string | null;
  readonly avatarUrl: string | null;
  readonly credentials: Buffer;
  readonly displayName: string | null;
  readonly email: string;
}

const refreshAccountProfile = Effect.fn("refreshAccountProfile")(
  function* refreshAccountProfile(row: StoredAccountRow) {
    const stored = yield* readStoredCredentials(row.credentials);
    const scopes = stored.scopes ?? [];
    const cached: GoogleAccount = {
      avatarUrl: toAvatarDataUrl(row.avatarData, row.avatarMediaType),
      displayName: row.displayName ?? undefined,
      email: row.email,
      scopes,
    };

    if (!scopes.some((scope) => GOOGLE_PROFILE_SCOPES.has(scope))) {
      return cached;
    }

    const credentials =
      stored.expiresAt !== undefined &&
      stored.expiresAt <= Date.now() + TOKEN_EXPIRY_BUFFER_MS
        ? yield* refreshCredentials(stored)
        : stored;
    const profile = yield* loadGoogleUserInfo(credentials.accessToken);

    if (profile.email.toLowerCase() !== row.accountId) {
      return yield* new GoogleAuthError({
        message: "Google profile did not match the connected account",
      });
    }

    const encryptedCredentials =
      credentials === stored
        ? row.credentials
        : yield* encryptStoredCredentials(credentials);
    const avatar =
      row.avatarData !== null && row.avatarUrl === (profile.picture ?? null)
        ? undefined
        : yield* downloadAvatar(profile.picture).pipe(
            Effect.orElseSucceed(() => NO_AVATAR)
          );
    const avatarData = avatar?.data ?? row.avatarData;
    const avatarMediaType = avatar?.mediaType ?? row.avatarMediaType;

    yield* withDatabase("Could not save Google profile", (database) =>
      database
        .update(mailAccounts)
        .set({
          avatarData,
          avatarMediaType,
          avatarUrl: profile.picture ?? null,
          credentials: encryptedCredentials,
          displayName: profile.name ?? null,
          updatedAt: Date.now(),
        })
        .where(equals(mailAccounts.accountId, row.accountId))
        .run()
    );

    return {
      avatarUrl: toAvatarDataUrl(avatarData, avatarMediaType),
      displayName: profile.name ?? row.displayName ?? undefined,
      email: row.email,
      scopes,
    } satisfies GoogleAccount;
  }
);

/**
 * An account is listed when it can sign in: every password account, and
 * Google accounts whose grant came from the user's own OAuth client.
 */
const isListedAccount = (row: {
  readonly authKind: "google-oauth" | "password";
  readonly credentials: Buffer;
}): Promise<boolean> =>
  row.authKind === "google-oauth"
    ? isUserOwnedOAuthClient(row.credentials)
    : Promise.resolve(true);

/**
 * Every connected account, Google or password, in the user's order. Only
 * Google accounts have a profile to refresh; the others list as saved.
 */
export const listGoogleAccounts = Effect.fn("listGoogleAccounts")(
  function* listGoogleAccounts() {
    yield* requireSecureStorage();
    const rows = yield* withDatabase("Could not load accounts", (database) =>
      database.query.mailAccounts.findMany({
        columns: {
          accountId: true,
          authKind: true,
          avatarData: true,
          avatarMediaType: true,
          avatarUrl: true,
          credentials: true,
          displayName: true,
          email: true,
        },
        // SQL ordering follows insertion order, so these keys are semantic.
        // oxlint-disable-next-line eslint/sort-keys
        orderBy: {
          sortOrder: "asc",
          createdAt: "asc",
          accountId: "asc",
        },
      })
    );

    const listedRows = yield* Effect.filter(
      rows,
      (row) => Effect.promise(() => isListedAccount(row)),
      { concurrency: 4 }
    );

    return yield* Effect.forEach(
      listedRows,
      (row) => {
        const saved: GoogleAccount = {
          avatarUrl: toAvatarDataUrl(row.avatarData, row.avatarMediaType),
          displayName: row.displayName ?? undefined,
          email: row.email,
          scopes: [],
        };

        return row.authKind === "google-oauth"
          ? refreshAccountProfile(row).pipe(Effect.orElseSucceed(() => saved))
          : Effect.succeed(saved);
      },
      { concurrency: 4 }
    );
  }
);

export const reorderGoogleAccounts = Effect.fn("reorderGoogleAccounts")(
  function* reorderGoogleAccounts(emails: readonly string[]) {
    yield* requireSecureStorage();
    const matchesStoredAccounts = yield* withDatabase(
      "Could not save account order",
      (database) =>
        database.transaction(async (transaction) => {
          const accountRows = await transaction
            .select({
              authKind: mailAccounts.authKind,
              credentials: mailAccounts.credentials,
              email: mailAccounts.email,
            })
            .from(mailAccounts)
            .all();
          const listed = await Promise.all(accountRows.map(isListedAccount));
          const storedEmails = new Set(
            accountRows
              .filter((_, index) => listed[index])
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
              .update(mailAccounts)
              .set({ sortOrder })
              .where(equals(mailAccounts.email, email))
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
        database.query.mailAccounts.findFirst({
          columns: { authKind: true, credentials: true },
          where: { accountId: email.toLowerCase() },
        })
    );

    // A password account has nothing to revoke, and its password must never
    // be sent anywhere but its own mail servers.
    if (account?.authKind !== "google-oauth") {
      return;
    }

    const stored = yield* readStoredCredentials(account.credentials);

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

    await Effect.runPromise(refreshUnreadBadge().pipe(Effect.ignore));

    // Reconnecting an already-indexed account is a no-op: the indexer ignores
    // the request once its state row reads `complete`.
    notifyAccountConnected(email);
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
