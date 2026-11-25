// How a connection is opened when a server refuses the account's sign-in.
// The connector and the sign-in are stand-ins; the session pool is real.
// oxlint-disable vitest/prefer-import-in-mock
import { MailAuthError, MailConnectionError } from "@repo/mail/errors";
import { AccountId } from "@repo/mail/ids";
import { ImapConnector } from "@repo/mail/session";
import type {
  ImapAuth,
  ImapConnectRequest,
  ImapSession,
} from "@repo/mail/session";
import type { MailAccount } from "@repo/mail/store";
import { Cause, Effect, Exit, Layer, Redacted } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  closeAllSessions,
  withAccountSession,
} from "../src/main/mail/engine/mail-sessions";
import { FakeImapServer } from "./fixtures/fake-imap-server";

const signIn = vi.hoisted(() => ({
  forgotten: [] as string[],
  next: [] as ImapAuth[],
}));

vi.mock("../src/main/mail/engine/account-credentials", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    forgetAccountSignIn: (accountId: string) => {
      signIn.forgotten.push(accountId);
    },
    resolveImapAuth: () =>
      MockEffect.suspend(() => {
        const auth = signIn.next.shift();
        return auth === undefined
          ? MockEffect.die("no sign-in left to hand out")
          : MockEffect.succeed(auth);
      }),
  };
});

const account: MailAccount = {
  accountId: AccountId.make("person@outlook.com"),
  dialect: "generic",
  email: "person@outlook.com",
  imap: { host: "outlook.office365.com", port: 993, security: "tls" },
  provider: "outlook",
  smtp: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
  username: "person@outlook.com",
};

const token = (value: string): ImapAuth => ({
  accessToken: Redacted.make(value),
  expiresAt: Date.now() + 3_600_000,
  kind: "oauth",
  user: account.username,
});
const password: ImapAuth = {
  kind: "password",
  password: Redacted.make("app-password"),
  user: account.username,
};

let requests: ImapConnectRequest[] = [];

/** Opens a session against a server that refuses the sign-ins named. */
const open = (refuses: (auth: ImapAuth) => "auth" | "network" | undefined) =>
  Effect.runPromiseExit(
    withAccountSession(account, "background", () =>
      Effect.succeed("opened")
    ).pipe(
      Effect.provide(
        Layer.succeed(
          ImapConnector,
          ImapConnector.of({
            connect: (request) =>
              Effect.suspend(
                (): Effect.Effect<
                  ImapSession,
                  MailAuthError | MailConnectionError
                > => {
                  requests.push(request);
                  const refusal = refuses(request.auth);
                  if (refusal === "auth") {
                    return Effect.fail(
                      new MailAuthError({
                        accountId: request.accountId,
                        message: "refused",
                      })
                    );
                  }
                  if (refusal === "network") {
                    return Effect.fail(
                      new MailConnectionError({
                        accountId: request.accountId,
                        message: "unreachable",
                      })
                    );
                  }
                  return Effect.succeed(
                    new FakeImapServer([{ path: "INBOX" }]).session()
                  );
                }
              ),
          })
        )
      )
    )
  );

const offered = () =>
  requests.map(({ auth }) =>
    auth.kind === "oauth" ? Redacted.value(auth.accessToken) : auth.kind
  );
const tagOf = (exit: Exit.Exit<unknown, { readonly _tag: string }>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
const isToken =
  (value: string) =>
  (auth: ImapAuth): boolean =>
    auth.kind === "oauth" && Redacted.value(auth.accessToken) === value;

describe("opening a connection", () => {
  beforeEach(() => {
    requests = [];
    signIn.forgotten = [];
    signIn.next = [];
  });

  afterEach(async () => {
    await Effect.runPromise(closeAllSessions);
  });

  it("renews an access token the server refuses and signs in with the new one", async () => {
    signIn.next = [token("stale"), token("fresh")];

    const exit = await open((auth) =>
      isToken("stale")(auth) ? "auth" : undefined
    );

    expect(exit).toStrictEqual(Exit.succeed("opened"));
    expect(offered()).toStrictEqual(["stale", "fresh"]);
    // The refused token was dropped, which is what makes the next one new.
    expect(signIn.forgotten).toStrictEqual([account.accountId]);
  });

  it("gives up once the renewed token is refused too", async () => {
    signIn.next = [token("stale"), token("fresh")];

    const exit = await open(() => "auth");

    expect(tagOf(exit)).toMatchObject({ _tag: "MailAuthError" });
    expect(offered()).toStrictEqual(["stale", "fresh"]);
    expect(signIn.forgotten).toHaveLength(2);
  });

  it("offers a refused password only once", async () => {
    signIn.next = [password];

    const exit = await open(() => "auth");

    expect(tagOf(exit)).toMatchObject({ _tag: "MailAuthError" });
    expect(offered()).toStrictEqual(["password"]);
  });

  it("does not renew a token over a server that could not be reached", async () => {
    signIn.next = [token("good")];

    const exit = await open(() => "network");

    expect(tagOf(exit)).toMatchObject({ _tag: "MailConnectionError" });
    expect(offered()).toStrictEqual(["good"]);
    expect(signIn.forgotten).toStrictEqual([]);
  });
});

const use = (owner: MailAccount, lane: "background" | "foreground" | "watch") =>
  withAccountSession(owner, lane, () => Effect.void);

describe("closing connections on quit", () => {
  const second: MailAccount = {
    ...account,
    accountId: AccountId.make("other@outlook.com"),
    email: "other@outlook.com",
    username: "other@outlook.com",
  };

  it("closes every account's connections together", async () => {
    signIn.next = [password, password, password, password, password, password];
    const connections = 6;
    let closing = 0;
    // Opens only once every close has started: closing one connection after
    // another would wait here forever.
    const everyCloseStarted = Promise.withResolvers<null>();
    const connector = Layer.succeed(
      ImapConnector,
      ImapConnector.of({
        connect: () =>
          Effect.acquireRelease(
            Effect.succeed(new FakeImapServer([{ path: "INBOX" }]).session()),
            () =>
              Effect.promise(() => {
                closing += 1;
                if (closing === connections) {
                  everyCloseStarted.resolve(null);
                }
                return everyCloseStarted.promise;
              })
          ),
      })
    );
    await Effect.runPromise(
      Effect.all([
        use(account, "background"),
        use(account, "foreground"),
        use(account, "watch"),
        use(second, "background"),
        use(second, "foreground"),
        use(second, "watch"),
      ]).pipe(Effect.provide(connector))
    );
    await Effect.runPromise(closeAllSessions);

    expect(closing).toBe(connections);
  });
});
