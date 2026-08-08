import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
] as const;
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

const PkceValue = Schema.String.check(Schema.isPattern(PKCE_PATTERN));
const ExchangeRequest = Schema.Struct({
  code: Schema.NonEmptyString,
  codeVerifier: PkceValue,
});
const RefreshRequest = Schema.Struct({
  refreshToken: Schema.NonEmptyString,
});
const AuthState = Schema.Struct({
  appRedirectUri: Schema.NonEmptyString,
  codeChallenge: PkceValue,
  createdAt: Schema.Finite,
});
const GoogleTokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.optional(Schema.Finite),
  refresh_token: Schema.optional(Schema.NonEmptyString),
  scope: Schema.NonEmptyString,
  token_type: Schema.NonEmptyString,
});

class GoogleTokenExchangeError extends Schema.TaggedErrorClass<GoogleTokenExchangeError>()(
  "GoogleTokenExchangeError",
  { message: Schema.String }
) {}

const decodeExchangeRequest = Schema.decodeUnknownEffect(ExchangeRequest);
const decodeRefreshRequest = Schema.decodeUnknownEffect(RefreshRequest);
const decodeAuthState = Schema.decodeUnknownPromise(AuthState);
const decodeGoogleTokenResponse =
  Schema.decodeUnknownPromise(GoogleTokenResponse);

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);

  for (const [index, character] of [...binary].entries()) {
    bytes[index] = character.codePointAt(0) ?? 0;
  }

  return bytes;
};

const errorResponse = (
  error: string,
  status: number
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.jsonUnsafe(
    { error },
    {
      headers: { "cache-control": "no-store" },
      status,
    }
  );

const redirectToApp = (
  appRedirectUri: string,
  parameters: Readonly<Record<string, string>>
): HttpServerResponse.HttpServerResponse => {
  const redirectUrl = new URL(appRedirectUri);

  for (const [key, value] of Object.entries(parameters)) {
    redirectUrl.searchParams.set(key, value);
  }

  return HttpServerResponse.redirect(redirectUrl);
};

const exchangeGoogleCode = Effect.fn("exchangeGoogleCode")(
  function* exchangeGoogleCode(options: {
    readonly authorizationCode: string;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }) {
    const response = yield* Effect.tryPromise({
      catch: () =>
        new GoogleTokenExchangeError({
          message: "Google token endpoint could not be reached",
        }),
      try: () =>
        fetch(GOOGLE_TOKEN_URL, {
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            code: options.authorizationCode,
            code_verifier: options.codeVerifier,
            grant_type: "authorization_code",
            redirect_uri: options.redirectUri,
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        }),
    });

    if (!response.ok) {
      return yield* new GoogleTokenExchangeError({
        message: `Google token endpoint returned ${response.status}`,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () =>
        new GoogleTokenExchangeError({
          message: "Google returned an invalid token response",
        }),
      try: async () => decodeGoogleTokenResponse(await response.json()),
    });
    const expiresAt =
      payload.expires_in === undefined
        ? undefined
        : Date.now() + payload.expires_in * 1000;
    const scopes = payload.scope.split(" ").filter((scope) => scope.length > 0);

    return {
      accessToken: payload.access_token,
      expiresAt,
      refreshToken: payload.refresh_token,
      scopes,
    };
  }
);

const refreshGoogleToken = Effect.fn("refreshGoogleToken")(
  function* refreshGoogleToken(options: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly refreshToken: string;
  }) {
    const response = yield* Effect.tryPromise({
      catch: () =>
        new GoogleTokenExchangeError({
          message: "Google token endpoint could not be reached",
        }),
      try: () =>
        fetch(GOOGLE_TOKEN_URL, {
          body: new URLSearchParams({
            client_id: options.clientId,
            client_secret: options.clientSecret,
            grant_type: "refresh_token",
            refresh_token: options.refreshToken,
          }),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          method: "POST",
        }),
    });

    if (!response.ok) {
      return yield* new GoogleTokenExchangeError({
        message: `Google token endpoint returned ${response.status}`,
      });
    }

    const payload = yield* Effect.tryPromise({
      catch: () =>
        new GoogleTokenExchangeError({
          message: "Google returned an invalid token response",
        }),
      try: async () => decodeGoogleTokenResponse(await response.json()),
    });

    return {
      accessToken: payload.access_token,
      expiresAt:
        payload.expires_in === undefined
          ? undefined
          : Date.now() + payload.expires_in * 1000,
      refreshToken: payload.refresh_token,
    };
  }
);

const importStateKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"]
  );

const createAuthState = Effect.fn("createAuthState")(function* createAuthState(
  state: typeof AuthState.Type,
  secret: string
) {
  return yield* Effect.tryPromise({
    catch: () =>
      new GoogleTokenExchangeError({
        message: "Could not create OAuth state",
      }),
    try: async () => {
      const payload = new TextEncoder().encode(JSON.stringify(state));
      const signature = await crypto.subtle.sign(
        "HMAC",
        await importStateKey(secret),
        payload
      );
      return `${bytesToBase64Url(payload)}.${bytesToBase64Url(
        new Uint8Array(signature)
      )}`;
    },
  });
});

const readAuthState = Effect.fn("readAuthState")(function* readAuthState(
  value: string,
  secret: string
) {
  return yield* Effect.tryPromise({
    catch: () =>
      new GoogleTokenExchangeError({ message: "Invalid OAuth state" }),
    try: async () => {
      const [encodedPayload, encodedSignature] = value.split(".");

      if (encodedPayload === undefined || encodedSignature === undefined) {
        throw new Error("Invalid state format");
      }

      const payload = base64UrlToBytes(encodedPayload);
      const isValid = await crypto.subtle.verify(
        "HMAC",
        await importStateKey(secret),
        base64UrlToBytes(encodedSignature),
        payload
      );

      if (!isValid) {
        throw new Error("Invalid state signature");
      }

      return decodeAuthState(JSON.parse(new TextDecoder().decode(payload)));
    },
  });
});

export default Cloudflare.Worker(
  "AuthWorker",
  { domain: "kisa.davutcaliskan.de", main: import.meta.url },
  Effect.gen(function* initializeWorker() {
    const appRedirectUris = yield* Config.string("APP_REDIRECT_URIS");
    const googleClientId = yield* Config.string("GOOGLE_CLIENT_ID");
    const googleClientSecret = yield* Config.redacted("GOOGLE_CLIENT_SECRET");
    const googleRedirectUri = yield* Config.string("GOOGLE_REDIRECT_URI");
    const allowedRedirectUris = new Set(
      appRedirectUris
        .split(",")
        .map((uri) => uri.trim())
        .filter((uri) => uri.length > 0)
    );

    const startAuthorization = Effect.fn("startAuthorization")(
      function* startAuthorization(url: URL) {
        const appRedirectUri = url.searchParams.get("redirect_uri");
        const codeChallenge = url.searchParams.get("code_challenge");

        if (
          appRedirectUri === null ||
          !allowedRedirectUris.has(appRedirectUri)
        ) {
          return errorResponse("invalid_redirect_uri", 400);
        }

        if (
          codeChallenge === null ||
          !PKCE_PATTERN.test(codeChallenge) ||
          url.searchParams.get("code_challenge_method") !== "S256"
        ) {
          return errorResponse("invalid_pkce_challenge", 400);
        }

        const state = yield* createAuthState(
          {
            appRedirectUri,
            codeChallenge,
            createdAt: Date.now(),
          },
          Redacted.value(googleClientSecret)
        );

        const authorizationUrl = new URL(GOOGLE_AUTH_URL);
        authorizationUrl.search = new URLSearchParams({
          access_type: "offline",
          client_id: googleClientId,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          include_granted_scopes: "true",
          prompt: "consent",
          redirect_uri: googleRedirectUri,
          response_type: "code",
          scope: GOOGLE_SCOPES.join(" "),
          state,
        }).toString();

        return HttpServerResponse.redirect(authorizationUrl);
      }
    );

    const finishAuthorization = Effect.fn("finishAuthorization")(
      function* finishAuthorization(url: URL) {
        const state = url.searchParams.get("state");

        if (state === null) {
          return errorResponse("missing_state", 400);
        }

        const pendingResult = yield* Effect.result(
          readAuthState(state, Redacted.value(googleClientSecret))
        );

        if (Result.isFailure(pendingResult)) {
          return errorResponse("invalid_or_expired_state", 400);
        }

        const pending = pendingResult.success;

        if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
          return errorResponse("invalid_or_expired_state", 400);
        }

        const googleError = url.searchParams.get("error");

        if (googleError !== null) {
          return redirectToApp(pending.appRedirectUri, {
            attempt: pending.codeChallenge,
            error: googleError,
          });
        }

        const authorizationCode = url.searchParams.get("code");

        if (authorizationCode === null) {
          return redirectToApp(pending.appRedirectUri, {
            attempt: pending.codeChallenge,
            error: "missing_authorization_code",
          });
        }

        return redirectToApp(pending.appRedirectUri, {
          attempt: pending.codeChallenge,
          code: authorizationCode,
        });
      }
    );

    const exchangeHandoff = Effect.fn("exchangeHandoff")(
      function* exchangeHandoff(request: HttpServerRequest) {
        const body = yield* Effect.result(
          request.json.pipe(Effect.flatMap(decodeExchangeRequest))
        );

        if (Result.isFailure(body)) {
          return errorResponse("invalid_exchange_request", 400);
        }

        const token = yield* Effect.result(
          exchangeGoogleCode({
            authorizationCode: body.success.code,
            clientId: googleClientId,
            clientSecret: Redacted.value(googleClientSecret),
            codeVerifier: body.success.codeVerifier,
            redirectUri: googleRedirectUri,
          })
        );

        if (Result.isFailure(token)) {
          return errorResponse("invalid_or_expired_code", 400);
        }

        return HttpServerResponse.jsonUnsafe(token.success, {
          headers: { "cache-control": "no-store" },
        });
      }
    );

    const refreshHandoff = Effect.fn("refreshHandoff")(function* refreshHandoff(
      request: HttpServerRequest
    ) {
      const body = yield* Effect.result(
        request.json.pipe(Effect.flatMap(decodeRefreshRequest))
      );

      if (Result.isFailure(body)) {
        return errorResponse("invalid_refresh_request", 400);
      }

      const token = yield* Effect.result(
        refreshGoogleToken({
          clientId: googleClientId,
          clientSecret: Redacted.value(googleClientSecret),
          refreshToken: body.success.refreshToken,
        })
      );

      if (Result.isFailure(token)) {
        return errorResponse("invalid_refresh_token", 401);
      }

      return HttpServerResponse.jsonUnsafe(token.success, {
        headers: { "cache-control": "no-store" },
      });
    });

    return {
      fetch: Effect.gen(function* handleRequest() {
        const request = yield* HttpServerRequest;
        const url = new URL(request.originalUrl);

        if (request.method === "GET" && url.pathname === "/health") {
          return HttpServerResponse.jsonUnsafe({ status: "ok" });
        }

        if (
          request.method === "GET" &&
          url.pathname === "/oauth/google/start"
        ) {
          return yield* startAuthorization(url);
        }

        if (
          request.method === "GET" &&
          url.pathname === "/oauth/google/callback"
        ) {
          return yield* finishAuthorization(url);
        }

        if (
          request.method === "POST" &&
          url.pathname === "/oauth/google/exchange"
        ) {
          return yield* exchangeHandoff(request);
        }

        if (
          request.method === "POST" &&
          url.pathname === "/oauth/google/refresh"
        ) {
          return yield* refreshHandoff(request);
        }

        return errorResponse("not_found", 404);
      }).pipe(Effect.orElseSucceed(() => errorResponse("internal_error", 500))),
    };
  })
);
