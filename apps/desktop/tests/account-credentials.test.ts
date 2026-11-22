// How an IMAP or SMTP connection gets an app password account's sign-in:
// decrypted from the saved row, redacted, and never echoed in a failure.
// oxlint-disable vitest/prefer-import-in-mock
import { AccountId } from "@repo/mail/ids";
import type { MailAccount } from "@repo/mail/store";
import { Cause, Effect, Exit, Redacted } from "effect";
import type * as Electron from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptPasswordCredentials } from "../src/main/auth/password-credentials";
import { resolveImapAuth } from "../src/main/mail/engine/account-credentials";
import { connection, resetDatabase } from "./fixtures/mail-engine-harness";

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

// Google sign-in is covered elsewhere; this keeps its module graph out.
vi.mock("../src/main/auth/auth", () => ({
  getGoogleAccessGrant: vi.fn<() => never>(),
}));

const PASSWORD = "abcd-efgh-ijkl-mnop";

const account: MailAccount = {
  accountId: AccountId.make("name@icloud.com"),
  authKind: "password",
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
      `INSERT INTO mail_accounts (account_id, auth_kind, created_at, credentials,
        dialect, email, imap_host, imap_port, imap_security, provider, smtp_host,
        smtp_port, smtp_security, sort_order, updated_at, username)
       VALUES (?, 'password', 0, ?, 'generic', ?, 'imap.mail.me.com', 993, 'tls',
        'icloud', 'smtp.mail.me.com', 587, 'starttls', 0, 0, ?)`
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

    expect(auth.kind).toBe("password");
    expect(auth.user).toBe("Name@iCloud.com");
    expect(auth.kind === "password" && Redacted.value(auth.password)).toBe(
      PASSWORD
    );
    expect(`${String(auth)} ${JSON.stringify(auth)}`).not.toContain(PASSWORD);
  });

  it("asks for the account again when the saved password cannot be read", async () => {
    // An OAuth-shaped blob, as if the row had been rewritten by Google sign-in.
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
