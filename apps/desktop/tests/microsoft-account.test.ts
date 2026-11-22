// Adding a Microsoft account against the in-memory database, fake IMAP
// sessions and a loopback SMTP server. The browser is a function that follows
// the redirect and Microsoft's token endpoint a stand-in `fetch`, so the real
// listener and the real token handling run. Electron's safeStorage is a
// reversible transform that is not the identity, so a stored row can prove
// the refresh token was sealed.
// oxlint-disable typescript/no-unsafe-type-assertion vitest/prefer-import-in-mock
import { ImapConnector } from "@repo/mail/session";
import type { ImapConnectRequest } from "@repo/mail/session";
import { Cause, Effect, Exit, Layer, Redacted } from "effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onAccountConnected } from "../src/main/auth/account-events";
import {
  decodeMicrosoftAccountRequest,
  MICROSOFT_ACCOUNT_MESSAGES,
  saveMicrosoftAccount,
  verifyMicrosoftAccount,
} from "../src/main/auth/microsoft-account";
import type { MicrosoftOAuthEnvironment } from "../src/main/auth/microsoft-oauth";
import { openSealedCredentials } from "../src/main/auth/sealed-credentials";
import { toTransportError } from "../src/main/mail/engine/imap-session";
import { SmtpSignIn } from "../src/main/mail/engine/smtp-sign-in";
import { verifyOverSmtp } from "../src/main/mail/engine/smtp-transport";
import { FakeImapServer } from "./fixtures/fake-imap-server";
import { startFakeSmtpServer } from "./fixtures/fake-smtp-server";
import type {
  FakeSmtpBehaviour,
  FakeSmtpServer,
} from "./fixtures/fake-smtp-server";
import {
  TestDatabase,
  connection,
  resetDatabase,
} from "./fixtures/mail-engine-harness";

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

const oauth = vi.hoisted(() => ({
  environment: undefined as MicrosoftOAuthEnvironment | undefined,
}));
vi.mock("../src/main/auth/microsoft-client", () => ({
  getMicrosoftOAuthEnvironment: () => oauth.environment,
  isMicrosoftSignInAvailable: () => oauth.environment !== undefined,
}));

const ACCESS_TOKEN = "access-token-value";
const REFRESH_TOKEN = "refresh-token-value";

// What Microsoft's IMAP server offers: no CONDSTORE, no SPECIAL-USE.
const OUTLOOK_CAPABILITIES = ["IDLE", "MOVE", "UIDPLUS"];
const OUTLOOK_MAILBOXES = [
  { path: "INBOX" },
  { path: "Sent Items" },
  { path: "Deleted Items" },
  { path: "Junk Email" },
  { path: "Drafts" },
];

const idToken = (email: string): string =>
  `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

/** Follows a redirect to the sign-in's listener, on the IPv4 loopback. */
const follow = async (url: string): Promise<void> => {
  const target = new URL(url);
  target.hostname = "127.0.0.1";
  const response = await fetch(target);
  await response.arrayBuffer();
};

interface AccountRow {
  readonly account_id: string;
  readonly credentials: Buffer;
  readonly dialect: string;
  readonly display_name: string | null;
  readonly email: string;
  readonly imap_host: string;
  readonly provider: string;
  readonly smtp_host: string;
  readonly smtp_port: number;
  readonly smtp_security: string;
  readonly username: string;
}

const accountRows = () =>
  connection
    .prepare(
      `SELECT account_id, credentials, dialect, display_name, email,
              imap_host, provider, smtp_host, smtp_port, smtp_security,
              username
       FROM mail_accounts ORDER BY account_id`
    )
    .all() as AccountRow[];

type ImapBehaviour = "accept" | "refuse" | "unreachable";

let smtp: FakeSmtpServer | undefined;
let imapRequests: ImapConnectRequest[] = [];
let tokenRequests: URLSearchParams[] = [];
let browserOpened = 0;
let connected: string[] = [];
let stopListening: (() => void) | undefined;

const layers = (imap: ImapBehaviour, smtpServer: FakeSmtpServer) =>
  Layer.mergeAll(
    TestDatabase,
    Layer.succeed(
      ImapConnector,
      ImapConnector.of({
        connect: (request) =>
          Effect.suspend(() => {
            imapRequests.push(request);
            if (imap === "refuse") {
              return Effect.fail(
                toTransportError(request.accountId, {
                  authenticationFailed: true,
                })
              );
            }
            if (imap === "unreachable") {
              return Effect.fail(
                toTransportError(request.accountId, { code: "ECONNREFUSED" })
              );
            }
            return Effect.succeed(
              new FakeImapServer(
                OUTLOOK_MAILBOXES,
                OUTLOOK_CAPABILITIES
              ).session()
            );
          }),
      })
    ),
    Layer.succeed(
      SmtpSignIn,
      SmtpSignIn.of({
        verify: (request) =>
          verifyOverSmtp(
            {
              connectionTimeout: 2000,
              greetingTimeout: 2000,
              host: "127.0.0.1",
              ignoreTLS: true,
              logger: false,
              port: smtpServer.port,
              socketTimeout: 2000,
            },
            request
          ),
      })
    )
  );

interface SignInOptions {
  /** What the redirect carries in place of a code. */
  readonly browserError?: string;
  readonly imap?: ImapBehaviour;
  /** Who Microsoft says signed in. */
  readonly signedInAs?: string;
  readonly smtp?: FakeSmtpBehaviour;
  readonly tokens?: Readonly<Record<string, number | string>>;
  readonly tokenStatus?: number;
}

const configureMicrosoft = (email: string, options: SignInOptions): void => {
  oauth.environment = {
    clientId: "11111111-2222-3333-4444-555555555555",
    fetch: (_url, init) => {
      tokenRequests.push(new URLSearchParams(String(init.body)));
      return Promise.resolve(
        Response.json(
          options.tokens ?? {
            access_token: ACCESS_TOKEN,
            expires_in: 3600,
            id_token: idToken(options.signedInAs ?? email),
            refresh_token: REFRESH_TOKEN,
          },
          { status: options.tokenStatus ?? 200 }
        )
      );
    },
    openBrowser: async (url) => {
      browserOpened += 1;
      const authorize = new URL(url);
      const redirect = new URL(
        authorize.searchParams.get("redirect_uri") ?? ""
      );
      redirect.searchParams.set(
        "state",
        authorize.searchParams.get("state") ?? ""
      );
      if (options.browserError === undefined) {
        redirect.searchParams.set("code", "the-code");
      } else {
        redirect.searchParams.set("error", options.browserError);
      }
      await follow(redirect.toString());
    },
  };
};

const addAccount = async (
  input: { readonly email: string; readonly name?: string },
  options: SignInOptions = {}
) => {
  smtp = await startFakeSmtpServer(options.smtp);
  configureMicrosoft(input.email.toLowerCase(), options);
  const all = layers(options.imap ?? "accept", smtp);
  return Effect.runPromiseExit(
    // As the setup window runs it: decode, verify, then save.
    decodeMicrosoftAccountRequest(input).pipe(
      Effect.flatMap(verifyMicrosoftAccount),
      Effect.flatMap(saveMicrosoftAccount),
      Effect.provide(all)
    )
  );
};

const exposed = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isFailure(exit)
    ? `${Cause.pretty(exit.cause)}\n${JSON.stringify(Cause.squash(exit.cause))}`
    : JSON.stringify(exit.value);

const failureMessage = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? (Cause.squash(exit.cause) as { readonly message?: string }).message
    : undefined;

const storedRefreshToken = async (row: AccountRow | undefined) => {
  const opened = await Effect.runPromise(
    openSealedCredentials(row?.credentials ?? Buffer.alloc(0))
  );
  return opened.kind === "microsoft-oauth"
    ? Redacted.value(opened.refreshToken)
    : opened.kind;
};

describe("adding a Microsoft account", () => {
  beforeEach(() => {
    resetDatabase();
    imapRequests = [];
    tokenRequests = [];
    browserOpened = 0;
    connected = [];
    stopListening = onAccountConnected((accountId) => {
      connected.push(accountId);
    });
  });

  afterEach(async () => {
    stopListening?.();
    oauth.environment = undefined;
    await smtp?.close();
    smtp = undefined;
  });

  it("signs in through the browser and opens the mailbox with the token it gets", async () => {
    const exit = await addAccount({ email: "Person@Outlook.com" });

    expect({ browserOpened, exit }).toStrictEqual({
      browserOpened: 1,
      exit: Exit.succeed("person@outlook.com"),
    });
    expect(
      imapRequests.map(({ auth, server }) => ({
        kind: auth.kind,
        server,
        token: auth.kind === "oauth" ? Redacted.value(auth.accessToken) : null,
        user: auth.user,
      }))
    ).toStrictEqual([
      {
        kind: "oauth",
        server: { host: "outlook.office365.com", port: 993, security: "tls" },
        token: ACCESS_TOKEN,
        user: "Person@Outlook.com",
      },
    ]);
    // SMTP took the same token with XOAUTH2, and nothing was sent.
    const [authentication = ""] = smtp?.authentications ?? [];
    const [method, sasl = ""] = authentication.split(" ").slice(1);
    expect({
      method,
      received: smtp?.received,
      sasl: Buffer.from(sasl, "base64").toString("utf-8"),
    }).toStrictEqual({
      method: "XOAUTH2",
      received: [],
      sasl: `user=Person@Outlook.com\u0001auth=Bearer ${ACCESS_TOKEN}\u0001\u0001`,
    });
  });

  it("stores the sealed refresh token, never the access token, and starts the account", async () => {
    await addAccount({ email: "person@outlook.com", name: " Person " });

    const [row] = accountRows();
    expect(row).toMatchObject({
      account_id: "person@outlook.com",
      dialect: "generic",
      display_name: "Person",
      email: "person@outlook.com",
      imap_host: "outlook.office365.com",
      provider: "outlook",
      smtp_host: "smtp-mail.outlook.com",
      smtp_port: 587,
      smtp_security: "starttls",
      username: "person@outlook.com",
    });
    await expect(storedRefreshToken(row)).resolves.toBe(REFRESH_TOKEN);
    const stored = unseal(row?.credentials ?? Buffer.alloc(0));
    expect(stored).not.toContain(ACCESS_TOKEN);
    expect(row?.credentials.includes(REFRESH_TOKEN)).toBeFalsy();
    expect(connected).toStrictEqual(["person@outlook.com"]);
  });

  it("sends a work or school address through Microsoft 365's outgoing server", async () => {
    await addAccount({ email: "me@contoso.example" });

    expect(accountRows()[0]).toMatchObject({
      imap_host: "outlook.office365.com",
      provider: "outlook",
      smtp_host: "smtp.office365.com",
    });
  });

  it("replaces the sign-in of an address already connected through Microsoft, keeping its mail", async () => {
    await addAccount({ email: "person@outlook.com", name: "Person" });
    await smtp?.close();
    connection
      .prepare(
        `INSERT INTO mail_mailboxes (account_id, delimiter, path, role,
           selectable, synced, updated_at)
         VALUES ('person@outlook.com', '/', 'INBOX', 'inbox', 1, 1, 1)`
      )
      .run();
    connected = [];

    const exit = await addAccount(
      { email: "person@outlook.com" },
      {
        tokens: {
          access_token: "access-again",
          id_token: idToken("person@outlook.com"),
          refresh_token: "refresh-again",
        },
      }
    );

    const rows = accountRows();
    expect({
      exit,
      // The name given the first time stays.
      names: rows.map((row) => row.display_name),
      refreshToken: await storedRefreshToken(rows[0]),
    }).toStrictEqual({
      exit: Exit.succeed("person@outlook.com"),
      names: ["Person"],
      refreshToken: "refresh-again",
    });
    // The cache is untouched.
    expect(
      connection.prepare("SELECT count(*) AS n FROM mail_mailboxes").get()
    ).toStrictEqual({ n: 1 });
    // The engine is told, so an account stuck on a refused sign-in resumes.
    expect(connected).toStrictEqual(["person@outlook.com"]);
  });

  it("refuses an address connected with a password before opening the browser", async () => {
    connection
      .prepare(
        `INSERT INTO mail_accounts (account_id, created_at, credentials,
           dialect, email, imap_host, imap_port, imap_security, provider,
           smtp_host, smtp_port, smtp_security, sort_order, updated_at,
           username)
         VALUES ('me@example.org', 1, X'01', 'generic', 'me@example.org',
           'imap.example.org', 993, 'tls', 'imap', 'smtp.example.org', 465,
           'tls', 1, 1, 'me@example.org')`
      )
      .run();
    const before = accountRows();

    const exit = await addAccount({ email: "me@example.org" });

    expect(failureMessage(exit)).toBe(
      MICROSOFT_ACCOUNT_MESSAGES.alreadyConnected
    );
    expect({ browserOpened, rows: accountRows() }).toStrictEqual({
      browserOpened: 0,
      rows: before,
    });
  });

  it("says to turn on IMAP when the mailbox refuses a token Microsoft just issued", async () => {
    const exit = await addAccount(
      { email: "person@outlook.com" },
      { imap: "refuse" }
    );

    expect(failureMessage(exit)).toBe(
      MICROSOFT_ACCOUNT_MESSAGES.mailboxRefused
    );
    expect(accountRows()).toStrictEqual([]);
    expect(connected).toStrictEqual([]);
    expect(exposed(exit)).not.toContain(ACCESS_TOKEN);
    expect(exposed(exit)).not.toContain(REFRESH_TOKEN);
  });

  it("says the browser signed in another account when the mailbox refuses that account's token", async () => {
    const exit = await addAccount(
      { email: "person@outlook.com" },
      { imap: "refuse", signedInAs: "someone-else@outlook.com" }
    );

    expect(failureMessage(exit)).toBe(
      MICROSOFT_ACCOUNT_MESSAGES.differentAccount
    );
    expect(accountRows()).toStrictEqual([]);
  });

  it("stores nothing when sending is refused", async () => {
    const exit = await addAccount(
      { email: "me@contoso.example" },
      { smtp: { authFails: true } }
    );

    expect(failureMessage(exit)).toBe(
      MICROSOFT_ACCOUNT_MESSAGES.sendingRefused
    );
    expect(accountRows()).toStrictEqual([]);
    expect(exposed(exit)).not.toContain(ACCESS_TOKEN);
  });

  it.each<readonly [string, SignInOptions, string]>([
    [
      "the user declines on Microsoft's page",
      { browserError: "access_denied" },
      MICROSOFT_ACCOUNT_MESSAGES.cancelled,
    ],
    [
      "Microsoft turns the code down",
      { tokenStatus: 400, tokens: { error: "invalid_grant" } },
      MICROSOFT_ACCOUNT_MESSAGES.refused,
    ],
    [
      "Microsoft's sign-in service is failing",
      { tokenStatus: 503, tokens: { error: "server_error" } },
      MICROSOFT_ACCOUNT_MESSAGES.unreachable,
    ],
    [
      "Microsoft issues no refresh token",
      { tokens: { access_token: ACCESS_TOKEN } },
      MICROSOFT_ACCOUNT_MESSAGES.notKept,
    ],
    [
      "the mail server cannot be reached",
      { imap: "unreachable" },
      MICROSOFT_ACCOUNT_MESSAGES.unreachable,
    ],
  ])("stores nothing when %s", async (_name, options, message) => {
    const exit = await addAccount({ email: "person@outlook.com" }, options);

    expect(failureMessage(exit)).toBe(message);
    expect(accountRows()).toStrictEqual([]);
    expect(connected).toStrictEqual([]);
  });

  it("is unavailable in a build without a Microsoft client", async () => {
    smtp = await startFakeSmtpServer();
    oauth.environment = undefined;

    const exit = await Effect.runPromiseExit(
      decodeMicrosoftAccountRequest({ email: "person@outlook.com" }).pipe(
        Effect.flatMap(verifyMicrosoftAccount),
        Effect.provide(layers("accept", smtp))
      )
    );

    expect(failureMessage(exit)).toBe(MICROSOFT_ACCOUNT_MESSAGES.unavailable);
    expect(imapRequests).toStrictEqual([]);
  });

  it.each([
    ["no body", undefined],
    ["no address", { name: "Person" }],
    ["an address without a domain", { email: "person" }],
    [
      "a name with a line break",
      { email: "a@outlook.com", name: "A\r\nBcc: x" },
    ],
  ])("rejects %s with one fixed message", async (_name, input) => {
    const exit = await Effect.runPromiseExit(
      decodeMicrosoftAccountRequest(input)
    );

    expect(failureMessage(exit)).toBe(
      MICROSOFT_ACCOUNT_MESSAGES.invalidRequest
    );
  });
});
