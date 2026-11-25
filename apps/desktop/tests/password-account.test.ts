import { AccountId } from "@repo/mail/ids";
// The add-account flow against the in-memory database, fake IMAP sessions and
// a loopback SMTP server. Only Electron's safeStorage is replaced, with a
// reversible transform that is not the identity, so a stored row can prove
// the password was sealed rather than written as is.
// oxlint-disable typescript/no-unsafe-type-assertion vitest/prefer-import-in-mock
import { ImapConnector } from "@repo/mail/session";
import type { ImapConnectRequest } from "@repo/mail/session";
import { Cause, Effect, Exit, Layer, Redacted } from "effect";
import type * as Electron from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onAccountConnected } from "../src/main/auth/account-events";
import {
  decodePasswordAccountRequest,
  findAccountSignIn,
  PASSWORD_ACCOUNT_MESSAGES,
  savePasswordAccount,
  savePasswordSignInAgain,
  verifyPasswordAccount,
  verifyPasswordSignInAgain,
} from "../src/main/auth/password-account";
import { decryptPasswordCredentials } from "../src/main/auth/password-credentials";
import { toTransportError } from "../src/main/mail/engine/imap-session";
import { SmtpSignIn } from "../src/main/mail/engine/smtp-sign-in";
import { verifyOverSmtp } from "../src/main/mail/engine/smtp-transport";
import type { PasswordAccountSetupInput } from "../src/shared/ipc/account-setup";
import { FakeImapServer } from "./fixtures/fake-imap-server";
import { startFakeSmtpServer } from "./fixtures/fake-smtp-server";
import type {
  FakeSmtpBehaviour,
  FakeSmtpServer,
} from "./fixtures/fake-smtp-server";
import {
  ALL_MAIL,
  GMAIL_MAILBOXES,
  ICLOUD_MAILBOXES,
  TestDatabase,
  connection,
  resetDatabase,
} from "./fixtures/mail-engine-harness";

/** Reverses the bytes: reversible, and never the plaintext itself. */
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

const PASSWORD = "abcd-efgh-ijkl-mnop";

interface AccountRow {
  readonly account_id: string;
  readonly credentials: Buffer;
  readonly dialect: string;
  readonly display_name: string | null;
  readonly email: string;
  readonly imap_host: string;
  readonly imap_port: number;
  readonly imap_security: string;
  readonly provider: string;
  readonly smtp_host: string;
  readonly smtp_port: number;
  readonly smtp_security: string;
  readonly username: string;
}

const accountRows = () =>
  connection
    .prepare(
      `SELECT account_id, credentials, dialect, display_name, email, imap_host,
              imap_port, imap_security, provider, smtp_host, smtp_port,
              smtp_security, username
       FROM mail_accounts ORDER BY account_id`
    )
    .all() as AccountRow[];

/**
 * How the fake IMAP server answers a sign-in: "accept" as a server without
 * Gmail's extensions, "gmail" as one that advertises them.
 */
type ImapBehaviour =
  | "accept"
  | "gmail"
  | "gmail-hiding-all-mail"
  | "refuse"
  | "unreachable";

const gmailServer = (behaviour: ImapBehaviour): FakeImapServer => {
  const server = new FakeImapServer(GMAIL_MAILBOXES);
  if (behaviour === "gmail-hiding-all-mail") {
    server.unlisted.add(ALL_MAIL);
  }
  return server;
};

let smtp: FakeSmtpServer | undefined;
let imapRequests: ImapConnectRequest[] = [];
let smtpRequests: Parameters<SmtpSignIn["Service"]["verify"]>[0][] = [];
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
              // The shape imapflow rejects with when LOGIN fails.
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
              imap === "gmail" || imap === "gmail-hiding-all-mail"
                ? gmailServer(imap).session()
                : new FakeImapServer(ICLOUD_MAILBOXES, [
                    "CONDSTORE",
                    "IDLE",
                  ]).session()
            );
          }),
      })
    ),
    Layer.succeed(
      SmtpSignIn,
      SmtpSignIn.of({
        // The real sign-in check, pointed at the plaintext loopback server.
        verify: (request) => {
          smtpRequests.push(request);
          return verifyOverSmtp(
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
          );
        },
      })
    )
  );

const addAccount = async (
  input: PasswordAccountSetupInput,
  options: {
    readonly imap?: ImapBehaviour;
    readonly smtp?: FakeSmtpBehaviour;
  } = {}
) => {
  smtp = await startFakeSmtpServer(options.smtp);
  return Effect.runPromiseExit(
    // As the setup window runs it: decode, verify, then save.
    decodePasswordAccountRequest(input).pipe(
      Effect.flatMap(verifyPasswordAccount),
      Effect.flatMap(savePasswordAccount),
      Effect.provide(layers(options.imap ?? "accept", smtp))
    )
  );
};

/** Everything a failure could expose, as one string. */
const exposed = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isFailure(exit)
    ? `${Cause.pretty(exit.cause)}\n${JSON.stringify(Cause.squash(exit.cause))}`
    : JSON.stringify(exit.value);

const failureMessage = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit)
    ? (Cause.squash(exit.cause) as { readonly message?: string }).message
    : undefined;

const manualServers = {
  imap: { host: "127.0.0.1", port: 993, security: "tls" },
  smtp: { host: "127.0.0.1", port: 587, security: "starttls" },
} as const;

const NEW_PASSWORD = "wxyz-wxyz-wxyz-wxyz";

/** Signs a connected account in again, as its setup window runs it. */
const signInAgain = async (
  accountId: string,
  password: string,
  options: {
    readonly imap?: ImapBehaviour;
    readonly smtp?: FakeSmtpBehaviour;
  } = {}
) => {
  await smtp?.close();
  smtp = await startFakeSmtpServer(options.smtp);
  return Effect.runPromiseExit(
    verifyPasswordSignInAgain(
      AccountId.make(accountId),
      Redacted.make(password)
    ).pipe(
      Effect.flatMap(savePasswordSignInAgain),
      Effect.provide(layers(options.imap ?? "accept", smtp))
    )
  );
};

const storedPassword = async (accountId: string): Promise<string> => {
  const row = accountRows().find(
    (candidate) => candidate.account_id === accountId
  );
  const stored = await Effect.runPromise(
    decryptPasswordCredentials(row?.credentials ?? Buffer.alloc(0))
  );
  return Redacted.value(stored);
};

/** Everything stored about an account except its sign-in. */
const withoutSignIn = (rows: readonly AccountRow[]) =>
  rows.map(({ credentials: _credentials, ...row }) => row);

describe("adding an app password account", () => {
  beforeEach(() => {
    resetDatabase();
    imapRequests = [];
    smtpRequests = [];
    connected = [];
    stopListening = onAccountConnected((accountId) => {
      connected.push(accountId);
    });
  });

  afterEach(async () => {
    stopListening?.();
    await smtp?.close();
    smtp = undefined;
  });

  it("signs in to both of Apple's iCloud servers with the address as typed", async () => {
    const exit = await addAccount({
      email: "Name@iCloud.com",
      password: PASSWORD,
    });

    expect(exit).toStrictEqual(Exit.succeed("name@icloud.com"));
    expect(
      imapRequests.map(({ auth, server }) => ({ server, user: auth.user }))
    ).toStrictEqual([
      {
        server: { host: "imap.mail.me.com", port: 993, security: "tls" },
        user: "Name@iCloud.com",
      },
    ]);
    expect(smtpRequests.map(({ server }) => server)).toStrictEqual([
      { host: "smtp.mail.me.com", port: 587, security: "starttls" },
    ]);
    // Signed in once and sent nothing.
    expect({
      authentications: smtp?.authentications.length,
      received: smtp?.received,
    }).toStrictEqual({ authentications: 1, received: [] });
  });

  it("stores the sealed password and starts the account", async () => {
    await addAccount({ email: "Name@iCloud.com", password: PASSWORD });

    const [row] = accountRows();
    expect(row).toMatchObject({
      account_id: "name@icloud.com",
      dialect: "generic",
      display_name: null,
      email: "name@icloud.com",
      imap_host: "imap.mail.me.com",
      imap_port: 993,
      imap_security: "tls",
      provider: "icloud",
      smtp_host: "smtp.mail.me.com",
      smtp_port: 587,
      smtp_security: "starttls",
      username: "Name@iCloud.com",
    });
    expect(row?.credentials.includes(PASSWORD)).toBeFalsy();
    const stored = await Effect.runPromise(
      decryptPasswordCredentials(row?.credentials ?? Buffer.alloc(0))
    );
    expect(Redacted.value(stored)).toBe(PASSWORD);
    expect(connected).toStrictEqual(["name@icloud.com"]);
  });

  it("uses the typed servers for another provider", async () => {
    const exit = await addAccount({
      email: "me@example.org",
      password: PASSWORD,
      servers: manualServers,
    });

    expect(Exit.isSuccess(exit)).toBeTruthy();
    expect(imapRequests[0]?.server).toStrictEqual(manualServers.imap);
    expect(smtpRequests[0]?.server).toStrictEqual(manualServers.smtp);
    expect(accountRows()[0]).toMatchObject({
      imap_host: "127.0.0.1",
      provider: "imap",
      smtp_security: "starttls",
    });
  });

  it("stores nothing when iCloud refuses the password", async () => {
    const exit = await addAccount(
      { email: "name@icloud.com", password: PASSWORD },
      { imap: "refuse" }
    );

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.icloudPasswordRefused
    );
    expect(smtpRequests).toStrictEqual([]);
    expect(accountRows()).toStrictEqual([]);
    expect(connected).toStrictEqual([]);
    expect(exposed(exit)).not.toContain(PASSWORD);
  });

  it("stores nothing when the outgoing server refuses the password", async () => {
    const exit = await addAccount(
      { email: "me@example.org", password: PASSWORD, servers: manualServers },
      { smtp: { authFails: true } }
    );

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.passwordRefused
    );
    expect({
      imapSignIns: imapRequests.length,
      smtpSignIns: smtp?.authentications.length,
    }).toStrictEqual({ imapSignIns: 1, smtpSignIns: 1 });
    expect(accountRows()).toStrictEqual([]);
    expect(connected).toStrictEqual([]);
    expect(exposed(exit)).not.toContain(PASSWORD);
  });

  it("says which server could not be reached", async () => {
    const incoming = await addAccount(
      { email: "me@example.org", password: PASSWORD, servers: manualServers },
      { imap: "unreachable" }
    );
    await smtp?.close();
    const outgoing = await addAccount(
      { email: "me@example.org", password: PASSWORD, servers: manualServers },
      { smtp: { dropAtGreeting: true } }
    );

    expect(failureMessage(incoming)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.incomingUnreachable
    );
    expect(failureMessage(outgoing)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.outgoingUnreachable
    );
    expect(accountRows()).toStrictEqual([]);
  });

  it("refuses an address that is already connected, before contacting a server", async () => {
    await addAccount({ email: "name@icloud.com", password: PASSWORD });
    await smtp?.close();
    imapRequests = [];
    const before = accountRows();

    const exit = await addAccount({
      email: "NAME@icloud.com",
      password: "another-password",
    });

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.alreadyConnected
    );
    expect({ connected, imapRequests, rows: accountRows() }).toStrictEqual({
      connected: ["name@icloud.com"],
      imapRequests: [],
      rows: before,
    });
  });

  it("refuses to save over an address connected while it was being verified", async () => {
    smtp = await startFakeSmtpServer();
    const verified = await Effect.runPromise(
      decodePasswordAccountRequest({
        email: "name@icloud.com",
        password: PASSWORD,
      }).pipe(
        Effect.flatMap(verifyPasswordAccount),
        Effect.provide(layers("accept", smtp))
      )
    );
    // Another sign-in for the same address finished first.
    await Effect.runPromise(
      savePasswordAccount(verified).pipe(Effect.provide(TestDatabase))
    );
    const before = accountRows();

    const exit = await Effect.runPromiseExit(
      savePasswordAccount(verified).pipe(Effect.provide(TestDatabase))
    );

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.alreadyConnected
    );
    expect(accountRows()).toStrictEqual(before);
    expect(connected).toStrictEqual(["name@icloud.com"]);
  });

  it("signs in to Gmail with the app password as Google shows it, and keeps Gmail's labels", async () => {
    const exit = await addAccount(
      {
        email: "Me@gmail.com",
        name: "  Me Person ",
        password: "abcd efgh ijkl mnop",
      },
      { imap: "gmail" }
    );

    expect(exit).toStrictEqual(Exit.succeed("me@gmail.com"));
    expect({
      imap: imapRequests[0]?.server,
      smtp: smtpRequests[0]?.server,
    }).toStrictEqual({
      imap: { host: "imap.gmail.com", port: 993, security: "tls" },
      smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    });
    expect(
      imapRequests.map(({ auth }) =>
        auth.kind === "password" ? Redacted.value(auth.password) : auth.kind
      )
    ).toStrictEqual(["abcdefghijklmnop"]);
    const [row] = accountRows();
    expect(row).toMatchObject({
      dialect: "gmail",
      display_name: "Me Person",
      provider: "gmail",
      username: "Me@gmail.com",
    });
    const stored = await Effect.runPromise(
      decryptPasswordCredentials(row?.credentials ?? Buffer.alloc(0))
    );
    expect(Redacted.value(stored)).toBe("abcdefghijklmnop");
  });

  // Connected that way, the account would sync Spam and Trash alone and
  // report itself complete, with none of its mail.
  it("refuses a Gmail account that hides All Mail from mail apps, and says how to show it", async () => {
    const exit = await addAccount(
      { email: "me@gmail.com", password: PASSWORD },
      { imap: "gmail-hiding-all-mail" }
    );

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.gmailAllMailHidden
    );
    expect(failureMessage(exit)).toMatch(/Show in IMAP/u);
    expect(accountRows()).toStrictEqual([]);
    expect(connected).toStrictEqual([]);
  });

  it("treats a hand-entered server that advertises Gmail's extensions as Gmail", async () => {
    const exit = await addAccount(
      {
        email: "me@company.example",
        password: PASSWORD,
        servers: manualServers,
      },
      { imap: "gmail" }
    );

    expect(Exit.isSuccess(exit)).toBeTruthy();
    // Only Google's own host gets its spaces dropped; this one has none.
    expect(
      imapRequests.map(({ auth }) =>
        auth.kind === "password" ? Redacted.value(auth.password) : auth.kind
      )
    ).toStrictEqual([PASSWORD]);
    expect(accountRows()[0]).toMatchObject({
      dialect: "gmail",
      imap_host: "127.0.0.1",
      provider: "gmail",
    });
  });

  it("names Google when Gmail refuses the password, and stores nothing", async () => {
    const exit = await addAccount(
      { email: "me@gmail.com", password: PASSWORD },
      { imap: "refuse" }
    );

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.gmailPasswordRefused
    );
    expect(accountRows()).toStrictEqual([]);
    expect(exposed(exit)).not.toContain(PASSWORD);
  });

  // The Add account window sends Gmail's servers for a domain Google hosts.
  it("names Google when it refuses a Google Workspace address, and drops the spaces", async () => {
    const exit = await addAccount(
      {
        email: "me@company.example",
        password: "abcd efgh ijkl mnop",
        servers: {
          imap: { host: "imap.gmail.com", port: 993, security: "tls" },
          smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
        },
      },
      { imap: "refuse" }
    );

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.gmailPasswordRefused
    );
    expect(
      imapRequests.map(({ auth }) =>
        auth.kind === "password" ? Redacted.value(auth.password) : auth.kind
      )
    ).toStrictEqual(["abcdefghijklmnop"]);
    expect(accountRows()).toStrictEqual([]);
  });

  it("leaves the sender name out when it is blank", async () => {
    await addAccount({
      email: "name@icloud.com",
      name: "   ",
      password: PASSWORD,
    });

    expect(accountRows()[0]?.display_name).toBeNull();
  });

  it("asks for servers it has no preset for", async () => {
    const noServers = await addAccount({
      email: "me@example.org",
      password: PASSWORD,
    });

    expect(failureMessage(noServers)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.serversRequired
    );
    expect(imapRequests).toStrictEqual([]);
    expect(accountRows()).toStrictEqual([]);
  });

  it.each([
    ["an Outlook.com address", { email: "me@outlook.com", password: PASSWORD }],
    [
      "a hand-entered Microsoft server",
      {
        email: "me@contoso.example",
        password: PASSWORD,
        servers: {
          ...manualServers,
          imap: { ...manualServers.imap, host: "Outlook.Office365.com" },
        },
      },
    ],
  ])(
    "sends %s to Microsoft sign-in without contacting a server",
    async (_name, input) => {
      const exit = await addAccount(input);

      // Microsoft's servers refuse every password, so none is offered to them.
      expect(failureMessage(exit)).toBe(PASSWORD_ACCOUNT_MESSAGES.microsoft);
      expect(imapRequests).toStrictEqual([]);
      expect(accountRows()).toStrictEqual([]);
    }
  );

  it("ignores typed servers for an address with a preset", async () => {
    await addAccount({
      email: "name@me.com",
      password: PASSWORD,
      servers: manualServers,
    });

    expect(imapRequests[0]?.server.host).toBe("imap.mail.me.com");
    expect(accountRows()[0]?.provider).toBe("icloud");
  });
});

describe("the add-account request", () => {
  const malformed: readonly (readonly [string, unknown])[] = [
    ["no body", undefined],
    ["a string", PASSWORD],
    ["no password", { email: "name@icloud.com" }],
    ["an empty password", { email: "name@icloud.com", password: "" }],
    [
      "a password with a line break",
      { email: "name@icloud.com", password: `${PASSWORD}\r\nA1 LOGOUT` },
    ],
    [
      "an overlong password",
      { email: "name@icloud.com", password: PASSWORD.repeat(100) },
    ],
    ["a non-string password", { email: "name@icloud.com", password: 1234 }],
    [
      "a name with a line break",
      {
        email: "name@icloud.com",
        name: "Name\r\nBcc: someone@example.com",
        password: PASSWORD,
      },
    ],
    [
      "an overlong name",
      { email: "name@icloud.com", name: "N".repeat(129), password: PASSWORD },
    ],
    ["no address", { password: PASSWORD }],
    ["an address without a domain", { email: "name", password: PASSWORD }],
    [
      "an address with spaces",
      { email: " name@icloud.com", password: PASSWORD },
    ],
    [
      "a host with spaces",
      {
        email: "me@example.org",
        password: PASSWORD,
        servers: {
          ...manualServers,
          imap: { ...manualServers.imap, host: "imap example.org" },
        },
      },
    ],
    [
      "port zero",
      {
        email: "me@example.org",
        password: PASSWORD,
        servers: {
          ...manualServers,
          smtp: { ...manualServers.smtp, port: 0 },
        },
      },
    ],
    [
      "plaintext security",
      {
        email: "me@example.org",
        password: PASSWORD,
        servers: {
          ...manualServers,
          imap: { ...manualServers.imap, security: "none" },
        },
      },
    ],
  ];

  it.each(malformed)(
    "rejects %s with one fixed message that never quotes the password",
    async (_name, input) => {
      const exit = await Effect.runPromiseExit(
        decodePasswordAccountRequest(input)
      );

      expect(failureMessage(exit)).toBe(
        PASSWORD_ACCOUNT_MESSAGES.invalidRequest
      );
      expect(exposed(exit)).not.toContain(PASSWORD);
    }
  );

  it("accepts a preset address with no servers, as the window sends it", async () => {
    const exit = await Effect.runPromiseExit(
      decodePasswordAccountRequest({
        email: "name@icloud.com",
        password: PASSWORD,
        servers: undefined,
      })
    );

    expect(Exit.isSuccess(exit)).toBeTruthy();
  });

  it("wraps the password in Redacted as it decodes", async () => {
    const request = await Effect.runPromise(
      decodePasswordAccountRequest({
        email: "name@icloud.com",
        password: PASSWORD,
      })
    );

    expect(Redacted.isRedacted(request.password)).toBeTruthy();
    expect(Redacted.value(request.password)).toBe(PASSWORD);
    expect(
      `${String(request.password)} ${JSON.stringify(request)}`
    ).not.toContain(PASSWORD);
  });
});

const findSignIn = (email: string) =>
  Effect.runPromiseExit(
    findAccountSignIn(email).pipe(Effect.provide(TestDatabase))
  );

describe("signing an app password account in again", () => {
  beforeEach(() => {
    resetDatabase();
    imapRequests = [];
    smtpRequests = [];
    connected = [];
    stopListening = onAccountConnected((accountId) => {
      connected.push(accountId);
    });
  });

  afterEach(async () => {
    stopListening?.();
    await smtp?.close();
    smtp = undefined;
  });

  it("replaces the password and keeps everything else, cached mail included", async () => {
    await addAccount({ email: "Name@iCloud.com", password: PASSWORD });
    connection
      .prepare(
        `INSERT INTO mail_messages (account_id, bcc_addresses, cc_addresses,
          from_address, is_draft, is_starred, is_unread, label_ids, message_id,
          received_at, size, subject, thread_id, to_addresses, updated_at)
         VALUES ('name@icloud.com', '[]', '[]', 'a@example.com', 0, 0, 1,
          '["INBOX"]', 'cached', 1, 1, 'Cached', 't', '[]', 1)`
      )
      .run();
    const before = withoutSignIn(accountRows());

    const exit = await signInAgain("name@icloud.com", NEW_PASSWORD);

    expect(exit).toStrictEqual(Exit.succeed("name@icloud.com"));
    await expect(storedPassword("name@icloud.com")).resolves.toBe(NEW_PASSWORD);
    expect(withoutSignIn(accountRows())).toStrictEqual(before);
    expect(
      connection.prepare("SELECT message_id FROM mail_messages").all()
    ).toStrictEqual([{ message_id: "cached" }]);
    expect(connected).toStrictEqual(["name@icloud.com", "name@icloud.com"]);
  });

  // Main decides from this which account a window signs in, and how.
  it("finds how a connected account signs in, by its address in any case", async () => {
    await addAccount({ email: "Name@iCloud.com", password: PASSWORD });
    connection
      .prepare(
        `INSERT INTO mail_accounts (account_id, created_at, credentials,
          dialect, email, imap_host, imap_port, imap_security, provider,
          smtp_host, smtp_port, smtp_security, sort_order, updated_at,
          username)
         VALUES ('me@outlook.com', 0, X'00', 'generic', 'me@outlook.com',
          'outlook.office365.com', 993, 'tls', 'outlook',
          'smtp-mail.outlook.com', 587, 'starttls', 0, 0, 'me@outlook.com')`
      )
      .run();
    await expect(findSignIn("NAME@ICLOUD.COM")).resolves.toStrictEqual(
      Exit.succeed({
        accountId: "name@icloud.com",
        email: "name@icloud.com",
        method: "password",
      })
    );
    await expect(findSignIn("me@outlook.com")).resolves.toStrictEqual(
      Exit.succeed({
        accountId: "me@outlook.com",
        email: "me@outlook.com",
        method: "microsoft",
      })
    );
    expect(failureMessage(await findSignIn("nobody@icloud.com"))).toBe(
      PASSWORD_ACCOUNT_MESSAGES.notConnected
    );
  });

  it("signs in with the stored servers and user name", async () => {
    await addAccount({
      email: "Me@Example.org",
      password: PASSWORD,
      servers: manualServers,
    });
    imapRequests = [];
    smtpRequests = [];

    await signInAgain("me@example.org", NEW_PASSWORD);

    expect(
      imapRequests.map(({ auth, server }) => ({
        server,
        user: auth.kind === "password" ? auth.user : undefined,
      }))
    ).toStrictEqual([{ server: manualServers.imap, user: "Me@Example.org" }]);
    expect(smtpRequests.map(({ server }) => server)).toStrictEqual([
      manualServers.smtp,
    ]);
  });

  it("refuses an address that is not connected, before contacting a server", async () => {
    const exit = await signInAgain("name@icloud.com", NEW_PASSWORD);

    expect(failureMessage(exit)).toBe(PASSWORD_ACCOUNT_MESSAGES.notConnected);
    expect({ connected, imapRequests, rows: accountRows() }).toStrictEqual({
      connected: [],
      imapRequests: [],
      rows: [],
    });
  });

  it("refuses an account that signs in with Microsoft", async () => {
    connection
      .prepare(
        `INSERT INTO mail_accounts (account_id, created_at, credentials,
          dialect, email, imap_host, imap_port, imap_security, provider,
          smtp_host, smtp_port, smtp_security, sort_order, updated_at,
          username)
         VALUES ('me@outlook.com', 0, X'00', 'generic', 'me@outlook.com',
          'outlook.office365.com', 993, 'tls', 'outlook',
          'smtp-mail.outlook.com', 587, 'starttls', 0, 0, 'me@outlook.com')`
      )
      .run();

    const exit = await signInAgain("me@outlook.com", NEW_PASSWORD);

    expect(failureMessage(exit)).toBe(PASSWORD_ACCOUNT_MESSAGES.usesMicrosoft);
    expect(imapRequests).toStrictEqual([]);
  });

  // The cache was built for the old kind of server, so it cannot carry over.
  // The account then says in Settings what to change at Gmail. Refusing the
  // password here would leave it with two things wrong instead of one.
  it("takes a new password for a Gmail account that hides All Mail", async () => {
    await addAccount(
      { email: "me@gmail.com", password: PASSWORD },
      { imap: "gmail" }
    );

    const exit = await signInAgain("me@gmail.com", NEW_PASSWORD, {
      imap: "gmail-hiding-all-mail",
    });

    expect(exit).toStrictEqual(Exit.succeed("me@gmail.com"));
    await expect(storedPassword("me@gmail.com")).resolves.toBe(NEW_PASSWORD);
  });

  it("refuses a server that now answers as Gmail, and keeps the old sign-in", async () => {
    await addAccount({
      email: "me@example.org",
      password: PASSWORD,
      servers: manualServers,
    });

    const exit = await signInAgain("me@example.org", NEW_PASSWORD, {
      imap: "gmail",
    });

    expect(failureMessage(exit)).toBe(PASSWORD_ACCOUNT_MESSAGES.serverChanged);
    await expect(storedPassword("me@example.org")).resolves.toBe(PASSWORD);
  });

  it("keeps the old sign-in when the server refuses the new password", async () => {
    await addAccount({ email: "name@icloud.com", password: PASSWORD });
    const before = accountRows();

    const exit = await signInAgain("name@icloud.com", NEW_PASSWORD, {
      imap: "refuse",
    });

    expect(failureMessage(exit)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.icloudPasswordRefused
    );
    expect(accountRows()).toStrictEqual(before);
    expect(connected).toStrictEqual(["name@icloud.com"]);
  });

  it("saves nothing for an account disconnected while it was being verified", async () => {
    await addAccount({ email: "name@icloud.com", password: PASSWORD });
    await smtp?.close();
    smtp = await startFakeSmtpServer();
    const verified = await Effect.runPromise(
      verifyPasswordSignInAgain(
        AccountId.make("name@icloud.com"),
        Redacted.make(NEW_PASSWORD)
      ).pipe(Effect.provide(layers("accept", smtp)))
    );
    connection.prepare("DELETE FROM mail_accounts").run();

    const exit = await Effect.runPromiseExit(
      savePasswordSignInAgain(verified).pipe(Effect.provide(TestDatabase))
    );

    expect(failureMessage(exit)).toBe(PASSWORD_ACCOUNT_MESSAGES.notConnected);
    expect(accountRows()).toStrictEqual([]);
    expect(connected).toStrictEqual(["name@icloud.com"]);
  });
});
