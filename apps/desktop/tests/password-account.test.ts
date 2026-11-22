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
  PASSWORD_ACCOUNT_MESSAGES,
  savePasswordAccount,
  verifyPasswordAccount,
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
  readonly auth_kind: string;
  readonly credentials: Buffer;
  readonly dialect: string;
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
      `SELECT account_id, auth_kind, credentials, dialect, email, imap_host,
              imap_port, imap_security, provider, smtp_host, smtp_port,
              smtp_security, username
       FROM mail_accounts ORDER BY account_id`
    )
    .all() as AccountRow[];

/** How the fake IMAP server answers a sign-in. */
type ImapBehaviour = "accept" | "refuse" | "unreachable";

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
              new FakeImapServer(ICLOUD_MAILBOXES).session()
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
      imapRequests.map(({ auth, server }) => ({
        kind: auth.kind,
        server,
        user: auth.user,
      }))
    ).toStrictEqual([
      {
        kind: "password",
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
      auth_kind: "password",
      dialect: "generic",
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

  it("sends Gmail to Google sign-in and asks for servers it has no preset for", async () => {
    const gmail = await addAccount({
      email: "me@gmail.com",
      password: PASSWORD,
    });
    await smtp?.close();
    const noServers = await addAccount({
      email: "me@example.org",
      password: PASSWORD,
    });

    expect(failureMessage(gmail)).toBe(PASSWORD_ACCOUNT_MESSAGES.gmail);
    expect(failureMessage(noServers)).toBe(
      PASSWORD_ACCOUNT_MESSAGES.serversRequired
    );
    expect(imapRequests).toStrictEqual([]);
    expect(accountRows()).toStrictEqual([]);
  });

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
