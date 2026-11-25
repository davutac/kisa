// How an IMAP or SMTP connection gets an account's sign-in: an app password
// decrypted from the saved row, or a Microsoft access token renewed from the
// sealed refresh token. Either is redacted and never echoed in a failure.
// Microsoft's token endpoint is a stand-in `fetch`.
// oxlint-disable vitest/prefer-import-in-mock
import { AccountId } from "@repo/mail/ids";
import type { MailAccount } from "@repo/mail/store";
import { Cause, Effect, Exit, Redacted } from "effect";
import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MicrosoftOAuthEnvironment } from "../src/main/auth/microsoft-oauth";
import { encryptPasswordCredentials } from "../src/main/auth/password-credentials";
import {
  openSealedCredentials,
  sealMicrosoftRefreshToken,
} from "../src/main/auth/sealed-credentials";
import {
  forgetAccountSignIn,
  resolveImapAuth,
} from "../src/main/mail/engine/account-credentials";
import { connection, resetDatabase } from "./fixtures/mail-engine-harness";
import { found } from "./fixtures/rows";

const seal = (value: string): Buffer =>
  Buffer.from(Buffer.from(value, "utf-8").toReversed());

const unseal = (value: Buffer): string =>
  Buffer.from(value.toReversed()).toString("utf-8");

vi.mock("electron", () => ({
  safeStorage: {
    decryptStringAsync: vi.fn<typeof Electron.safeStorage.decryptStringAsync>(
      (value) =>
        Promise.resolve({ result: unseal(value), shouldReEncrypt: false })
    ),
    encryptStringAsync: vi.fn<typeof Electron.safeStorage.encryptStringAsync>(
      (value) => Promise.resolve(seal(value))
    ),
    getSelectedStorageBackend: vi.fn<
      typeof Electron.safeStorage.getSelectedStorageBackend
    >(() => "gnome_libsecret"),
    isAsyncEncryptionAvailable: vi.fn<
      typeof Electron.safeStorage.isAsyncEncryptionAvailable
    >(() => Promise.resolve(true)),
  },
}));

vi.mock("../src/main/database", async () => {
  const { remoteDatabase } = await import("./fixtures/mail-engine-harness");
  const { Effect: MockEffect } = await import("effect");

  return {
    withDatabaseClient: <A>(
      run: (database: typeof remoteDatabase) => Promise<A>
    ) => MockEffect.promise(() => run(remoteDatabase)),
  };
});

// SAFETY: each assertion in this object only widens an empty starting value,
// `[]` or `undefined`, to the type the tests fill it with.
const oauth = vi.hoisted(() => ({
  environment: undefined as MicrosoftOAuthEnvironment | undefined,
}));

vi.mock("../src/main/auth/microsoft-client", () => ({
  getMicrosoftOAuthEnvironment: () => oauth.environment,
}));

const PASSWORD = "abcd-efgh-ijkl-mnop";

const account: MailAccount = {
  accountId: AccountId.make("name@icloud.com"),
  dialect: "generic",
  email: "name@icloud.com",
  imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
  provider: "icloud",
  smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  username: "Name@iCloud.com",
};

const insertPasswordAccount = (credentials: Buffer): void => {
  connection
    .prepare(
      `INSERT INTO mail_accounts (account_id, created_at, credentials, dialect,
        email, imap_host, imap_port, imap_security, provider, smtp_host,
        smtp_port, smtp_security, sort_order, updated_at, username)
       VALUES (?, 0, ?, 'generic', ?, 'imap.mail.me.com', 993, 'tls', 'icloud',
        'smtp.mail.me.com', 587, 'starttls', 0, 0, ?)`
    )
    .run(account.accountId, credentials, account.email, account.username);
};

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;

describe("resolving an app password account's sign-in", () => {
  beforeEach(() => {
    resetDatabase();
  });

  it("decrypts the saved password for the sign-in name, redacted", async () => {
    insertPasswordAccount(
      await Effect.runPromise(
        encryptPasswordCredentials(Redacted.make(PASSWORD))
      )
    );

    const auth = await Effect.runPromise(resolveImapAuth(account));

    expect(auth.user).toBe("Name@iCloud.com");
    expect(auth.kind === "password" && Redacted.value(auth.password)).toBe(
      PASSWORD
    );
    expect(`${String(auth)} ${JSON.stringify(auth)}`).not.toContain(PASSWORD);
  });

  it("asks for the account again when the saved password cannot be read", async () => {
    // A sealed blob that is not a password, such as an OAuth grant left by
    // an earlier build, must never be sent to a server as one.
    insertPasswordAccount(seal(JSON.stringify({ accessToken: PASSWORD })));

    const exit = await Effect.runPromiseExit(resolveImapAuth(account));
    const failure = failureOf(exit);

    expect(failure).toMatchObject({ _tag: "MailAuthError" });
    expect(
      `${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""} ${JSON.stringify(failure)}`
    ).not.toContain(PASSWORD);
  });

  it("refuses an account that is no longer connected", async () => {
    const exit = await Effect.runPromiseExit(resolveImapAuth(account));

    expect(failureOf(exit)).toMatchObject({
      _tag: "MailAuthError",
      message: "This account is not connected",
    });
  });
});

/** A reply from Microsoft's token endpoint, made when it is asked. */
const tokens =
  (body: Readonly<Record<string, number | string>>, status = 200) =>
  () =>
    Response.json(body, { status });

describe("resolving a Microsoft account's sign-in", () => {
  const outlook: MailAccount = {
    accountId: AccountId.make("person@outlook.com"),
    dialect: "generic",
    email: "person@outlook.com",
    imap: { host: "outlook.office365.com", port: 993, security: "tls" },
    provider: "outlook",
    smtp: { host: "smtp-mail.outlook.com", port: 587, security: "starttls" },
    username: "Person@Outlook.com",
  };

  let renewals: URLSearchParams[] = [];

  /** Microsoft's token endpoint, answering each renewal in turn. */
  const answerWith = (
    ...replies: readonly (() => Response | Promise<Response>)[]
  ): void => {
    let next = 0;
    oauth.environment = {
      clientId: "11111111-2222-3333-4444-555555555555",
      fetch: (_url, init) => {
        renewals.push(new URLSearchParams(String(init.body)));
        const reply = replies[Math.min(next, replies.length - 1)];
        next += 1;

        return Promise.resolve(reply?.() ?? Response.error());
      },
      openBrowser: () => Promise.reject(new Error("no browser in a renewal")),
    };
  };

  const insertOutlookAccount = async (refreshToken: string): Promise<void> => {
    const credentials = await Effect.runPromise(
      sealMicrosoftRefreshToken(Redacted.make(refreshToken))
    );

    connection
      .prepare(
        `INSERT INTO mail_accounts (account_id, created_at, credentials,
          dialect, email, imap_host, imap_port, imap_security, provider,
          smtp_host, smtp_port, smtp_security, sort_order, updated_at,
          username)
         VALUES (?, 0, ?, 'generic', ?, 'outlook.office365.com', 993, 'tls',
          'outlook', 'smtp-mail.outlook.com', 587, 'starttls', 0, 0, ?)`
      )
      .run(outlook.accountId, credentials, outlook.email, outlook.username);
  };

  const storedRefreshToken = async (): Promise<string | undefined> => {
    const row = connection
      .prepare<unknown[], { credentials: Buffer }>(
        "SELECT credentials FROM mail_accounts WHERE account_id = ?"
      )
      .get(outlook.accountId);

    if (row === undefined) {
      return undefined;
    }

    const opened = await Effect.runPromise(
      openSealedCredentials(row.credentials)
    );

    return opened.kind === "microsoft-oauth"
      ? Redacted.value(opened.refreshToken)
      : opened.kind;
  };

  const accessTokenOf = (auth: Awaited<ReturnType<typeof resolve>>) =>
    auth.kind === "oauth" ? Redacted.value(auth.accessToken) : auth.kind;

  const resolve = () => Effect.runPromise(resolveImapAuth(outlook));

  beforeEach(() => {
    resetDatabase();
    forgetAccountSignIn(outlook.accountId);
    renewals = [];
  });

  it("renews an access token from the refresh token for the sign-in name", async () => {
    await insertOutlookAccount("refresh-1");
    answerWith(tokens({ access_token: "access-1", expires_in: 3600 }));
    const before = Date.now();

    const auth = await resolve();

    expect(auth).toMatchObject({ kind: "oauth", user: "Person@Outlook.com" });
    expect(accessTokenOf(auth)).toBe("access-1");
    expect(auth.kind === "oauth" && auth.expiresAt - before).toBeGreaterThan(
      3_500_000
    );
    expect(renewals.map((body) => body.get("refresh_token"))).toStrictEqual([
      "refresh-1",
    ]);
    expect(`${String(auth)} ${JSON.stringify(auth)}`).not.toContain("access-1");
  });

  it("keeps the token in memory and renews once for connections opened together", async () => {
    await insertOutlookAccount("refresh-1");
    answerWith(tokens({ access_token: "access-1", expires_in: 3600 }));

    const [first, second] = await Promise.all([resolve(), resolve()]);
    const third = await resolve();

    expect([first, second, third].map(accessTokenOf)).toStrictEqual([
      "access-1",
      "access-1",
      "access-1",
    ]);
    expect(renewals).toHaveLength(1);
  });

  it("renews a token that is about to run out", async () => {
    await insertOutlookAccount("refresh-1");
    answerWith(
      // Four minutes left once the safety margin is taken off.
      tokens({ access_token: "short-lived", expires_in: 300 }),
      tokens({ access_token: "fresh", expires_in: 3600 })
    );

    const first = await resolve();
    const second = await resolve();

    expect([first, second].map(accessTokenOf)).toStrictEqual([
      "short-lived",
      "fresh",
    ]);
    expect(renewals).toHaveLength(2);
  });

  it("stores the refresh token Microsoft replaces the old one with", async () => {
    await insertOutlookAccount("refresh-1");
    answerWith(
      tokens({
        access_token: "access-1",
        expires_in: 3600,
        refresh_token: "refresh-2",
      })
    );

    await resolve();

    await expect(storedRefreshToken()).resolves.toBe("refresh-2");

    // The access token itself is never written down.
    const row = found(
      connection
        .prepare<unknown[], { credentials: Buffer }>(
          "SELECT credentials FROM mail_accounts"
        )
        .get()
    );

    expect(unseal(row.credentials)).not.toContain("access-1");
  });

  it("does not bring back an account removed while its token was renewed", async () => {
    await insertOutlookAccount("refresh-1");
    answerWith(() => {
      connection.prepare("DELETE FROM mail_accounts").run();

      return Response.json({
        access_token: "access-1",
        refresh_token: "refresh-2",
      });
    });

    await resolve();

    await expect(storedRefreshToken()).resolves.toBeUndefined();
  });

  it("renews again once a server has refused the token", async () => {
    await insertOutlookAccount("refresh-1");
    answerWith(
      tokens({ access_token: "refused-by-server", expires_in: 3600 }),
      tokens({ access_token: "renewed", expires_in: 3600 })
    );

    await resolve();
    forgetAccountSignIn(outlook.accountId);

    expect(accessTokenOf(await resolve())).toBe("renewed");
  });

  it("asks for a new sign-in only when Microsoft refuses the refresh token", async () => {
    await insertOutlookAccount("refresh-secret");
    answerWith(tokens({ error: "invalid_grant" }, 400));

    const exit = await Effect.runPromiseExit(resolveImapAuth(outlook));

    expect(failureOf(exit)).toMatchObject({
      _tag: "MailAuthError",
      message: "Sign in to Microsoft again to keep receiving mail",
    });
    expect(
      `${Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""} ${JSON.stringify(failureOf(exit))}`
    ).not.toContain("refresh-secret");
  });

  it.each<readonly [string, () => Response | Promise<Response>]>([
    ["Microsoft's service is failing", tokens({ error: "server_error" }, 503)],
    ["Microsoft is throttling", tokens({ error: "slow_down" }, 429)],
    ["the network is down", () => Promise.reject(new Error("offline"))],
  ])(
    "treats it as a lost connection, not a sign-out, when %s",
    async (_name, reply) => {
      await insertOutlookAccount("refresh-1");
      answerWith(reply);

      const exit = await Effect.runPromiseExit(resolveImapAuth(outlook));

      expect(failureOf(exit)).toMatchObject({ _tag: "MailConnectionError" });
      // The stored sign-in is left as it was, to be used again later.
      await expect(storedRefreshToken()).resolves.toBe("refresh-1");
    }
  );

  it("cannot renew in a build without a Microsoft client", async () => {
    await insertOutlookAccount("refresh-1");
    oauth.environment = undefined;

    const exit = await Effect.runPromiseExit(resolveImapAuth(outlook));

    expect(failureOf(exit)).toMatchObject({
      _tag: "MailAuthError",
      message: "This build of Kisa can't sign in to Microsoft accounts",
    });
  });
});
