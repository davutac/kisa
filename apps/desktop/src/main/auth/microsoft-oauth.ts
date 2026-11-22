// Sign-in for Microsoft mailboxes (Outlook.com, Microsoft 365), which take no
// passwords from mail apps. This is the authorization-code flow for native
// apps (RFC 8252) with PKCE (RFC 7636): the system browser shows Microsoft's
// sign-in page, which redirects to a one-time listener on the loopback
// interface, and the code it brings is exchanged for tokens. Nothing here
// touches storage or a window; it only speaks the protocol.

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { Server } from "node:http";

import { Effect, Option, Predicate, Redacted, Schema } from "effect";

import { renderSignInCallbackPage } from "./sign-in-callback-page";

const AUTHORIZE_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

/**
 * What IMAP and SMTP need, and a refresh token. It is sent with every token
 * request: left out, a personal account's renewed token covers IMAP while
 * SMTP refuses it (`535 5.7.3`).
 */
const MAIL_SCOPE =
  "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access";
/**
 * Asked for at the browser sign-in only: who signed in, so a mailbox that
 * will not open can be told from another account picked on Microsoft's page.
 */
const IDENTITY_SCOPE = "openid email";

/** How long the user has to finish in the browser. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;
/** A token counts as expired this long before Microsoft says it is. */
const EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_LIFETIME_SECONDS = 3600;
const MAX_LIFETIME_SECONDS = 86_400;
const MAX_ADDRESS_LENGTH = 320;

/**
 * Why a Microsoft sign-in or renewal did not produce tokens.
 *
 * - `refused`: Microsoft turned the request down. Only signing in again helps.
 * - `unavailable`: the service or the network failed. Nothing was refused,
 *   so the same request is worth trying again later.
 * - `cancelled`: the user declined on Microsoft's page.
 * - `timeout`: the browser sign-in was not finished in time.
 * - `local`: the listener or the browser could not be started.
 */
// oxlint-disable-next-line unicorn/throw-new-error
export class MicrosoftSignInError extends Schema.TaggedError<MicrosoftSignInError>()(
  "MicrosoftSignInError",
  {
    kind: Schema.Literals([
      "cancelled",
      "local",
      "refused",
      "timeout",
      "unavailable",
    ]),
  }
) {}

const failWith = (kind: MicrosoftSignInError["kind"]): MicrosoftSignInError =>
  new MicrosoftSignInError({ kind });

/** What the protocol needs from outside, so tests can stand in for each. */
export interface MicrosoftOAuthEnvironment {
  /** Kisa's registration with Microsoft: a public client, so no secret. */
  readonly clientId: string;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Shows a page in the system browser. */
  readonly openBrowser: (url: string) => Promise<void>;
}

export interface MicrosoftTokens {
  readonly accessToken: Redacted.Redacted<string>;
  /** When the access token stops being used, in milliseconds since the epoch. */
  readonly expiresAt: number;
  /**
   * The token to renew with next. Microsoft issues a new one with each
   * renewal and expects the old one to be discarded.
   */
  readonly refreshToken: Redacted.Redacted<string> | undefined;
  /** The address of whoever signed in, when the sign-in asked for it. */
  readonly signedInAs: string | undefined;
}

const TokenResponse = Schema.Struct({
  access_token: Schema.NonEmptyString,
  expires_in: Schema.optional(Schema.Finite),
  id_token: Schema.optional(Schema.String),
  refresh_token: Schema.optional(Schema.String),
});
const TokenFailure = Schema.Struct({
  error: Schema.String,
  error_codes: Schema.optional(Schema.Array(Schema.Finite)),
});
const IdentityClaims = Schema.Struct({
  email: Schema.optional(Schema.String),
  preferred_username: Schema.optional(Schema.String),
});

const decodeTokenResponse = Schema.decodeUnknownOption(TokenResponse);
const decodeTokenFailure = Schema.decodeUnknownOption(TokenFailure);
const decodeIdentityClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(IdentityClaims)
);

/**
 * What may be logged of Microsoft's answer: its error name and Entra's
 * numbered codes (`AADSTS…`), which say what to change in the registration.
 * Never its description, which can quote the request.
 */
const ERROR_NAME_PATTERN = /^[a-z_]{1,64}$/u;
const ENTRA_CODE_PATTERN = /\bAADSTS(?<code>\d{1,9})\b/u;

const describeFailure = (
  error: string,
  codes: readonly number[] | undefined
): string =>
  [
    ERROR_NAME_PATTERN.test(error) ? error : "unrecognized error",
    ...(codes ?? []).slice(0, 4).map((code) => `AADSTS${Math.trunc(code)}`),
  ].join(" ");

/** Microsoft's own words for "busy, try again", as opposed to a refusal. */
const TRANSIENT_FAILURES: ReadonlySet<string> = new Set([
  "server_error",
  "temporarily_unavailable",
]);

/**
 * The address in an ID token: a JWT whose middle part is base64url JSON. It
 * came straight from Microsoft over TLS and is only ever compared with the
 * account's own address, so its signature is not checked.
 */
export const readSignedInAddress = (idToken: string): string | undefined => {
  const [, payload] = idToken.split(".");

  if (payload === undefined) {
    return undefined;
  }

  const claims = decodeIdentityClaims(
    Buffer.from(payload, "base64url").toString("utf-8")
  );

  if (Option.isNone(claims)) {
    return undefined;
  }

  return [claims.value.email, claims.value.preferred_username]
    .map((address) => address?.trim() ?? "")
    .find(
      (address) => address.includes("@") && address.length < MAX_ADDRESS_LENGTH
    );
};

const toTokens = (
  response: typeof TokenResponse.Type,
  now: number
): MicrosoftTokens => {
  const lifetime = Math.min(
    Math.max(response.expires_in ?? DEFAULT_LIFETIME_SECONDS, 60),
    MAX_LIFETIME_SECONDS
  );

  return {
    accessToken: Redacted.make(response.access_token, {
      label: "Microsoft access token",
    }),
    expiresAt: now + lifetime * 1000 - EXPIRY_MARGIN_MS,
    refreshToken:
      response.refresh_token === undefined ||
      response.refresh_token.length === 0
        ? undefined
        : Redacted.make(response.refresh_token, {
            label: "Microsoft refresh token",
          }),
    signedInAs:
      response.id_token === undefined
        ? undefined
        : readSignedInAddress(response.id_token),
  };
};

/**
 * One request to the token endpoint. A response is read as JSON whatever its
 * status: Microsoft describes a refusal in the body of a `400`.
 */
const requestTokens = Effect.fn("MicrosoftOAuth.requestTokens")(
  function* requestTokens(
    environment: MicrosoftOAuthEnvironment,
    fields: Readonly<Record<string, string>>
  ) {
    const response = yield* Effect.tryPromise({
      catch: () => failWith("unavailable"),
      try: async (signal) => {
        const reply = await environment.fetch(TOKEN_URL, {
          body: new URLSearchParams({
            ...fields,
            client_id: environment.clientId,
          }),
          headers: { accept: "application/json" },
          method: "POST",
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
          ]),
        });
        // The body holds tokens, so it is decoded here and never logged.
        const body: unknown = await reply.json().catch(() => null);
        return { body, status: reply.status };
      },
    });
    const tokens = decodeTokenResponse(response.body);

    if (
      response.status >= 200 &&
      response.status < 300 &&
      Option.isSome(tokens)
    ) {
      return toTokens(tokens.value, Date.now());
    }

    const failure = decodeTokenFailure(response.body);
    const isTransient =
      response.status >= 500 ||
      response.status === 429 ||
      (Option.isSome(failure) && TRANSIENT_FAILURES.has(failure.value.error));

    yield* Effect.logWarning(
      `Microsoft token request failed: HTTP ${response.status}, ${
        Option.isSome(failure)
          ? describeFailure(failure.value.error, failure.value.error_codes)
          : "no error in the reply"
      }`
    );

    // A refusal needs Microsoft to have said so. Anything else unreadable is
    // the service misbehaving, which must not sign the account out.
    return yield* failWith(
      !isTransient && Option.isSome(failure) ? "refused" : "unavailable"
    );
  }
);

/** Renews an access token. Its reply may carry the refresh token to use next. */
export const refreshMicrosoftTokens = (
  environment: MicrosoftOAuthEnvironment,
  refreshToken: Redacted.Redacted<string>
): Effect.Effect<MicrosoftTokens, MicrosoftSignInError> =>
  requestTokens(environment, {
    grant_type: "refresh_token",
    refresh_token: Redacted.value(refreshToken),
    scope: MAIL_SCOPE,
  });

interface Redirect {
  readonly code: string;
  readonly redirectUri: string;
  readonly verifier: string;
}

const closeListener = (server: Server): void => {
  server.close();
  server.closeAllConnections();
};

const CALLBACK_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

/**
 * Opens Microsoft's sign-in page and waits for its redirect.
 *
 * The listener is bound to the loopback interface on a port the operating
 * system picks, and lives only as long as this effect: finishing, failing,
 * timing out or being interrupted closes it. The redirect names `localhost`,
 * the one host whose port Microsoft does not compare with the registration.
 * Only a request carrying this attempt's `state` counts; a browser's other
 * requests (a favicon, a connection opened ahead of time) are answered and
 * ignored, so they cannot end the wait.
 */
const awaitRedirect = (
  environment: MicrosoftOAuthEnvironment,
  loginHint: string
): Effect.Effect<Redirect, MicrosoftSignInError> =>
  Effect.callback<Redirect, MicrosoftSignInError>((resume) => {
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    let redirectUri = "";
    // Aborted once the wait is over, however it ended: by its result, or by
    // the effect being interrupted.
    const ended = new AbortController();
    const settle = (
      result: Effect.Effect<Redirect, MicrosoftSignInError>
    ): void => {
      if (!ended.signal.aborted) {
        ended.abort();
        resume(result);
      }
    };

    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (
        request.method !== "GET" ||
        url.pathname !== "/" ||
        url.searchParams.get("state") !== state
      ) {
        response.writeHead(404, { "content-length": "0" }).end();
        return;
      }

      const code = url.searchParams.get("code") ?? "";
      const error = url.searchParams.get("error") ?? "";
      const outcome = code.length > 0 ? undefined : error || "invalid_request";
      if (outcome !== undefined) {
        const entraCode = ENTRA_CODE_PATTERN.exec(
          url.searchParams.get("error_description") ?? ""
        )?.groups?.code;
        console.warn(
          `Microsoft sign-in came back refused: ${describeFailure(
            outcome,
            entraCode === undefined ? undefined : [Number(entraCode)]
          )}`
        );
      }

      response.writeHead(outcome === undefined ? 200 : 400, CALLBACK_HEADERS);
      response.end(renderSignInCallbackPage(outcome), () => {
        // Closed once the page is written, so the browser is not left with a
        // reset connection in place of it.
        closeListener(server);
      });

      if (outcome === undefined) {
        settle(Effect.succeed({ code, redirectUri, verifier }));
      } else {
        settle(
          Effect.fail(
            failWith(outcome === "access_denied" ? "cancelled" : "refused")
          )
        );
      }
    });
    const timeout = setTimeout(() => {
      closeListener(server);
      settle(Effect.fail(failWith("timeout")));
    }, SIGN_IN_TIMEOUT_MS);
    ended.signal.addEventListener("abort", () => clearTimeout(timeout));

    server.once("error", () => {
      closeListener(server);
      settle(Effect.fail(failWith("local")));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();

      if (address === null || Predicate.isString(address)) {
        closeListener(server);
        settle(Effect.fail(failWith("local")));
        return;
      }

      redirectUri = `http://localhost:${address.port}`;
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: environment.clientId,
        code_challenge: challenge,
        code_challenge_method: "S256",
        login_hint: loginHint,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: `${MAIL_SCOPE} ${IDENTITY_SCOPE}`,
        state,
      }).toString();

      const open = async (): Promise<void> => {
        try {
          await environment.openBrowser(url.toString());
        } catch {
          closeListener(server);
          settle(Effect.fail(failWith("local")));
        }
      };
      void open();
    });

    return Effect.sync(() => {
      ended.abort();
      closeListener(server);
    });
  });

/**
 * The whole browser sign-in: Microsoft's page, the redirect, and the code
 * exchanged for tokens. `loginHint` is the address being added, which
 * Microsoft's page starts with.
 */
export const signInWithMicrosoft = Effect.fn("MicrosoftOAuth.signIn")(
  function* signInWithMicrosoft(
    environment: MicrosoftOAuthEnvironment,
    loginHint: string
  ) {
    const redirect = yield* awaitRedirect(environment, loginHint);

    return yield* requestTokens(environment, {
      code: redirect.code,
      code_verifier: redirect.verifier,
      grant_type: "authorization_code",
      redirect_uri: redirect.redirectUri,
      scope: `${MAIL_SCOPE} ${IDENTITY_SCOPE}`,
    });
  }
);
