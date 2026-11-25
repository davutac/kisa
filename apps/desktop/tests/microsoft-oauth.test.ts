// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
// Microsoft sign-in against the real loopback listener: the "browser" is a
// function that requests the redirect, and the token endpoint is a stand-in
// `fetch`. No request leaves the machine and no real token is involved.
import { createHash } from "node:crypto";

import { it as effectIt } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  readSignedInAddress,
  refreshMicrosoftTokens,
  signInWithMicrosoft,
} from "../src/main/auth/microsoft-oauth";
import type { MicrosoftOAuthEnvironment } from "../src/main/auth/microsoft-oauth";

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";

const MAIL_SCOPE =
  "https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send offline_access";

type TokenBody = Readonly<Record<string, number | string>>;

const idToken = (claims: Readonly<Record<string, string>>): string =>
  `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

/**
 * One GET to the listener, as a browser makes it; resolves with its status.
 * The redirect names `localhost`; the listener is on the IPv4 loopback.
 */
const visit = async (url: string): Promise<number> => {
  const target = new URL(url);
  target.hostname = "127.0.0.1";
  const response = await fetch(target);
  await response.arrayBuffer();

  return response.status;
};

interface TokenCall {
  readonly body: URLSearchParams;
  readonly url: string;
}

const environment = (
  browser: (authorizeUrl: URL) => Promise<void>,
  reply: (call: TokenCall) => Response | Promise<Response>
) => {
  const calls: TokenCall[] = [];

  return {
    calls,
    environment: {
      clientId: CLIENT_ID,
      fetch: (url, init) => {
        const call = { body: new URLSearchParams(String(init.body)), url };
        calls.push(call);

        return Promise.resolve(reply(call));
      },
      openBrowser: (url) => browser(new URL(url)),
    } satisfies MicrosoftOAuthEnvironment,
  };
};

const tokenReply = (body: TokenBody, status = 200): Response =>
  Response.json(body, { status });

const failureKind = (exit: Exit.Exit<unknown, { readonly kind: string }>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

/** The redirect a sign-in page sends the browser back with. */
const redirectOf = (
  authorizeUrl: URL,
  outcome: Readonly<Record<string, string>>
): string => {
  const redirect = new URL(authorizeUrl.searchParams.get("redirect_uri") ?? "");
  redirect.searchParams.set(
    "state",
    authorizeUrl.searchParams.get("state") ?? ""
  );

  for (const [name, value] of Object.entries(outcome)) {
    redirect.searchParams.set(name, value);
  }

  return redirect.toString();
};

/** A browser that signs in at once and comes back with a code. */
const signsIn =
  (code = "the-code") =>
  async (authorizeUrl: URL): Promise<void> => {
    await visit(redirectOf(authorizeUrl, { code }));
  };

/** A renewal against a token endpoint that answers with `reply`. */
const refresh = (reply: () => Response | Promise<Response>) => {
  const { calls, environment: oauth } = environment(
    () => Promise.resolve(),
    reply
  );

  return {
    calls,
    run: () =>
      Effect.runPromiseExit(
        refreshMicrosoftTokens(oauth, Redacted.make("refresh-old"))
      ),
  };
};

describe("Microsoft browser sign-in", () => {
  it("asks for mail access with PKCE and exchanges the code it gets back", async () => {
    let authorize: URL | undefined;

    const { calls, environment: oauth } = environment(
      async (url) => {
        authorize = url;
        await signsIn()(url);
      },
      () =>
        tokenReply({
          access_token: "access-1",
          expires_in: 3600,
          id_token: idToken({ email: "Person@Outlook.com" }),
          refresh_token: "refresh-1",
        })
    );

    const before = Date.now();

    const tokens = await Effect.runPromise(
      signInWithMicrosoft(oauth, "person@outlook.com")
    );

    const query = authorize?.searchParams;
    const [exchange] = calls;
    expect({
      client: query?.get("client_id"),
      endpoint: `${authorize?.origin}${authorize?.pathname}`,
      hint: query?.get("login_hint"),
      method: query?.get("code_challenge_method"),
      redirect: query?.get("redirect_uri")?.replace(/\d+$/u, "PORT"),
      response: query?.get("response_type"),
      scope: query?.get("scope"),
    }).toStrictEqual({
      client: CLIENT_ID,
      endpoint:
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      hint: "person@outlook.com",
      method: "S256",
      // `localhost` is the one host whose port Microsoft does not compare.
      redirect: "http://localhost:PORT",
      response: "code",
      scope: `${MAIL_SCOPE} openid email`,
    });
    expect({
      ...Object.fromEntries(exchange?.body ?? []),
      // The verifier sent with the code is the one the challenge was made
      // from.
      code_verifier: createHash("sha256")
        .update(exchange?.body.get("code_verifier") ?? "")
        .digest("base64url"),
      url: exchange?.url,
    }).toStrictEqual({
      client_id: CLIENT_ID,
      code: "the-code",
      code_verifier: query?.get("code_challenge"),
      grant_type: "authorization_code",
      redirect_uri: query?.get("redirect_uri"),
      scope: `${MAIL_SCOPE} openid email`,
      url: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    });
    expect({
      access: Redacted.value(tokens.accessToken),
      refresh: tokens.refreshToken && Redacted.value(tokens.refreshToken),
      signedInAs: tokens.signedInAs,
    }).toStrictEqual({
      access: "access-1",
      refresh: "refresh-1",
      signedInAs: "Person@Outlook.com",
    });
    // A minute early, so a token never runs out mid-command.
    expect(tokens.expiresAt - before).toBeGreaterThan(3_500_000);
    expect(
      `${String(tokens.accessToken)} ${JSON.stringify(tokens)}`
    ).not.toContain("access-1");
  });

  it("ignores a browser's other requests and waits for its own redirect", async () => {
    const statuses: number[] = [];

    const { environment: oauth } = environment(
      async (url) => {
        const base = url.searchParams.get("redirect_uri") ?? "";
        statuses.push(
          await visit(`${base}/favicon.ico`),
          // Another program guessing at the listener has no state to offer.
          await visit(`${base}/?code=stolen&state=guess`)
        );
        await signsIn("real-code")(url);
      },
      (call) =>
        tokenReply({
          access_token: `for-${call.body.get("code")}`,
          refresh_token: "refresh",
        })
    );

    const tokens = await Effect.runPromise(
      signInWithMicrosoft(oauth, "a@b.example")
    );

    expect(statuses).toStrictEqual([404, 404]);
    expect(Redacted.value(tokens.accessToken)).toBe("for-real-code");
  });

  it("stops listening once the redirect has arrived", async () => {
    let redirect = "";

    const { environment: oauth } = environment(
      async (url) => {
        redirect = url.searchParams.get("redirect_uri") ?? "";
        await signsIn()(url);
      },
      () => tokenReply({ access_token: "a", refresh_token: "r" })
    );

    await Effect.runPromise(signInWithMicrosoft(oauth, "a@b.example"));

    await expect(visit(`${redirect}/?code=again&state=x`)).rejects.toThrow(
      "fetch failed"
    );
  });

  it.each([
    ["access_denied", "cancelled"],
    ["server_error", "refused"],
  ])(
    "reports a redirect with %s as %s without asking for tokens",
    async (outcome, kind) => {
      const { calls, environment: oauth } = environment(
        async (url) => {
          await visit(redirectOf(url, { error: outcome }));
        },
        () => tokenReply({ access_token: "never" })
      );

      const exit = await Effect.runPromiseExit(
        signInWithMicrosoft(oauth, "a@b.example")
      );

      expect(failureKind(exit)).toMatchObject({ kind });
      expect(calls).toStrictEqual([]);
    }
  );

  it("closes the listener when the sign-in is cancelled while the browser is open", async () => {
    let redirect = "";

    const { promise: browserOpened, resolve: opened } =
      Promise.withResolvers<undefined>();

    const { calls, environment: oauth } = environment(
      (url) => {
        redirect = url.searchParams.get("redirect_uri") ?? "";
        opened(undefined);

        return Promise.resolve();
      },
      () => tokenReply({ access_token: "never" })
    );

    const fiber = Effect.runFork(signInWithMicrosoft(oauth, "a@b.example"));
    await browserOpened;
    await Effect.runPromise(Fiber.interrupt(fiber));

    await expect(visit(`${redirect}/?code=late&state=x`)).rejects.toThrow(
      "fetch failed"
    );
    expect(calls).toStrictEqual([]);
  });

  effectIt.effect(
    "gives up and closes the listener when no redirect arrives in time",
    () =>
      Effect.gen(function* timesOutSignIn() {
        let redirect = "";
        const browserOpened = Promise.withResolvers<undefined>();

        const { calls, environment: oauth } = environment(
          (url) => {
            redirect = url.searchParams.get("redirect_uri") ?? "";
            browserOpened.resolve(undefined);

            return Promise.resolve();
          },
          () => tokenReply({ access_token: "never" })
        );

        const signIn = yield* Effect.forkChild(
          signInWithMicrosoft(oauth, "a@b.example")
        );

        yield* Effect.promise(() => browserOpened.promise);
        yield* TestClock.adjust("10 minutes");
        const exit = yield* Fiber.await(signIn);

        expect(failureKind(exit)).toMatchObject({ kind: "timeout" });
        yield* Effect.promise(() =>
          expect(visit(`${redirect}/?code=late&state=x`)).rejects.toThrow(
            "fetch failed"
          )
        );
        expect(calls).toStrictEqual([]);
      })
  );

  it("reports a browser that cannot be opened", async () => {
    const { environment: oauth } = environment(
      () => Promise.reject(new Error("no browser")),
      () => tokenReply({ access_token: "never" })
    );

    const exit = await Effect.runPromiseExit(
      signInWithMicrosoft(oauth, "a@b.example")
    );

    expect(failureKind(exit)).toMatchObject({ kind: "local" });
  });
});

describe("Microsoft token requests", () => {
  it("renews with the mail permissions named again and takes the replaced refresh token", async () => {
    const { calls, run } = refresh(() =>
      tokenReply({ access_token: "access-2", refresh_token: "refresh-new" })
    );

    const exit = await run();

    // Without the scope a personal account's renewed token reads mail but is
    // refused for sending.
    expect(Object.fromEntries(calls[0]?.body ?? [])).toStrictEqual({
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: "refresh-old",
      scope: MAIL_SCOPE,
    });
    const renewed = Exit.isSuccess(exit) ? exit.value : undefined;
    expect({
      access: renewed && Redacted.value(renewed.accessToken),
      refresh: renewed?.refreshToken && Redacted.value(renewed.refreshToken),
    }).toStrictEqual({ access: "access-2", refresh: "refresh-new" });
  });

  it.each<readonly [string, () => Response | Promise<Response>, string]>([
    [
      "a revoked grant",
      () => tokenReply({ error: "invalid_grant" }, 400),
      "refused",
    ],
    [
      "a busy service",
      () => tokenReply({ error: "temporarily_unavailable" }, 400),
      "unavailable",
    ],
    [
      "a server error",
      () => tokenReply({ error: "server_error" }, 500),
      "unavailable",
    ],
    [
      "throttling",
      () => tokenReply({ error: "slow_down" }, 429),
      "unavailable",
    ],
    [
      "a reply that is not JSON",
      () => new Response("<html>gateway</html>", { status: 502 }),
      "unavailable",
    ],
    [
      "a success without a token",
      () => tokenReply({ token_type: "Bearer" }),
      "unavailable",
    ],
    ["no network", () => Promise.reject(new Error("offline")), "unavailable"],
  ])("tells %s apart", async (_name, reply, kind) => {
    const exit = await refresh(reply).run();

    expect(failureKind(exit)).toMatchObject({ kind });
  });

  it("never puts a token in a failure", async () => {
    const exit = await refresh(() =>
      tokenReply(
        { error: "invalid_grant", error_description: "refresh-old" },
        400
      )
    ).run();

    expect(
      Exit.isFailure(exit)
        ? `${Cause.pretty(exit.cause)} ${JSON.stringify(Cause.squash(exit.cause))}`
        : ""
    ).not.toContain("refresh-old");
  });
});

describe(readSignedInAddress, () => {
  it("reads the address from an ID token's claims", () => {
    expect(readSignedInAddress(idToken({ email: " a@outlook.com " }))).toBe(
      "a@outlook.com"
    );
    expect(
      readSignedInAddress(idToken({ preferred_username: "b@contoso.example" }))
    ).toBe("b@contoso.example");
  });

  it("reads nothing from a token that names no address", () => {
    expect(
      readSignedInAddress(idToken({ email: "not an address" }))
    ).toBeUndefined();
    expect(readSignedInAddress("not-a-jwt")).toBeUndefined();
    expect(readSignedInAddress("a.!!!.c")).toBeUndefined();
  });
});
