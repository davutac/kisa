import { mailAccounts } from "@repo/database/schemas";
import { GMAIL_ALL_MAIL_HIDDEN, dialects } from "@repo/mail/dialects";
import type { DialectKind } from "@repo/mail/dialects";
import type { MailTransportError } from "@repo/mail/errors";
import { AccountId } from "@repo/mail/ids";
import { ImapConnector } from "@repo/mail/session";
import type { ImapAuth } from "@repo/mail/session";
import type { MailSendError } from "@repo/mail/smtp";
import { and, eq, ne } from "drizzle-orm";
import { Effect, Redacted, Schema } from "effect";

import { PasswordAccountSetupRequest } from "../../shared/ipc/account-setup";
import {
  findMailAccountPreset,
  isGoogleMailHost,
  isMicrosoftConsumerAddress,
  isMicrosoftMailHost,
  toAccountProvider,
} from "../../shared/mail-account-presets";
import type { MailServerSettings } from "../../shared/mail-account-presets";
import { MailDatabase } from "../mail/engine/mail-database";
import { SmtpSignIn } from "../mail/engine/smtp-sign-in";
import { notifyAccountConnected } from "./account-events";
import { requireSecureCredentialStorage } from "./credential-storage";
import { encryptPasswordCredentials } from "./password-credentials";

/**
 * Every failure the Add account window can show. Messages are fixed text:
 * a server's reply can echo the address or the command, and the request
 * itself carries the password, so neither may reach the reply or a log.
 */
export const PASSWORD_ACCOUNT_MESSAGES = {
  alreadyConnected: "This account is already connected.",
  gmailAllMailHidden: `${GMAIL_ALL_MAIL_HIDDEN} Then try again.`,
  gmailPasswordRefused:
    "Gmail refused the password. Use an app password, not your Google Account password.",
  gmailUnexpected: "Gmail did not respond as expected. Try again later.",
  gmailUnreachable:
    "Could not reach Gmail. Check your connection and try again.",
  icloudPasswordRefused:
    "iCloud refused the password. Use an app-specific password, not your Apple Account password.",
  icloudUnexpected: "iCloud Mail did not respond as expected. Try again later.",
  icloudUnreachable:
    "Could not reach iCloud Mail. Check your connection and try again.",
  incomingUnexpected:
    "The incoming mail server did not respond as expected. Check its settings.",
  incomingUnreachable:
    "Could not reach the incoming mail server. Check its settings and your connection.",
  invalidRequest: "Check the email address, password and server settings.",
  notConnected: "This account is no longer connected.",
  microsoft:
    "Outlook and Microsoft 365 accounts sign in with Microsoft, not a password.",
  outgoingUnexpected:
    "The outgoing mail server did not respond as expected. Check its settings.",
  outgoingUnreachable:
    "Could not reach the outgoing mail server. Check its settings and your connection.",
  passwordRefused: "The mail server refused the email address or password.",
  saveFailed: "Could not save the account.",
  serverChanged:
    "The mail server no longer answers as it did when this account was added. Disconnect the account and add it again.",
  serversRequired: "Enter the incoming and outgoing server settings.",
  throttled: "The mail server is busy. Try again in a few minutes.",
  usesMicrosoft: "This account signs in with Microsoft.",
} as const;

// oxlint-disable-next-line unicorn/throw-new-error
export class PasswordAccountError extends Schema.TaggedError<
  PasswordAccountError,
  { readonly brand: unique symbol }
>()("PasswordAccountError", { message: Schema.String }) {}

const failWith = (message: string): PasswordAccountError =>
  new PasswordAccountError({ message });

const decodeRequest = Schema.decodeUnknownEffect(PasswordAccountSetupRequest);

/**
 * Decodes the setup window's request, wrapping the password in `Redacted`.
 * Any issue becomes one fixed message: a schema issue quotes the value it
 * rejected, which could be the password.
 */
export const decodePasswordAccountRequest = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The setup window's request is decoded here, at the IPC boundary.
  input: unknown
): Effect.Effect<PasswordAccountSetupRequest, PasswordAccountError> =>
  decodeRequest(input).pipe(
    Effect.mapError(() => failWith(PASSWORD_ACCOUNT_MESSAGES.invalidRequest))
  );

export interface AccountPlan {
  readonly accountId: AccountId;
  /** The sender name on outgoing mail, if the user gave one. */
  readonly displayName: string | undefined;
  /** Lowercased: the renderer keys accounts by this, as by `accountId`. */
  readonly email: string;
  readonly imap: MailServerSettings;
  readonly provider: "gmail" | "icloud" | "imap";
  readonly smtp: MailServerSettings;
  /** The address as typed, which servers may compare exactly. */
  readonly username: string;
}

const planAccount = Effect.fn("planPasswordAccount")(function* planAccount(
  request: PasswordAccountSetupRequest
) {
  const email = request.email.toLowerCase();
  const preset = findMailAccountPreset(email);
  const servers = preset ?? request.servers;

  if (servers === undefined) {
    return yield* failWith(
      // Microsoft's servers refuse every password, so asking for server
      // settings would only lead to a sign-in that cannot work.
      isMicrosoftConsumerAddress(email)
        ? PASSWORD_ACCOUNT_MESSAGES.microsoft
        : PASSWORD_ACCOUNT_MESSAGES.serversRequired
    );
  }

  if (isMicrosoftMailHost(servers.imap.host)) {
    return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.microsoft);
  }

  const displayName = request.name?.trim();

  return {
    accountId: AccountId.make(email),
    displayName:
      displayName === undefined || displayName.length === 0
        ? undefined
        : displayName,
    email,
    imap: servers.imap,
    provider: preset?.provider ?? "imap",
    smtp: servers.smtp,
    username: request.email,
  } satisfies AccountPlan;
});

/** A preset provider's own wording, which names the provider. */
const PROVIDER_MESSAGES = {
  gmail: {
    passwordRefused: PASSWORD_ACCOUNT_MESSAGES.gmailPasswordRefused,
    unexpected: PASSWORD_ACCOUNT_MESSAGES.gmailUnexpected,
    unreachable: PASSWORD_ACCOUNT_MESSAGES.gmailUnreachable,
  },
  icloud: {
    passwordRefused: PASSWORD_ACCOUNT_MESSAGES.icloudPasswordRefused,
    unexpected: PASSWORD_ACCOUNT_MESSAGES.icloudUnexpected,
    unreachable: PASSWORD_ACCOUNT_MESSAGES.icloudUnreachable,
  },
} as const;

/**
 * The provider whose wording a failure uses. A custom domain on Google's or
 * Apple's servers, such as a Google Workspace domain, gets theirs too.
 */
const findProviderMessages = (plan: AccountPlan) => {
  const provider = toAccountProvider({
    imapHost: plan.imap.host,
    provider: plan.provider,
  });

  return provider === "gmail" || provider === "icloud"
    ? PROVIDER_MESSAGES[provider]
    : undefined;
};

/** Says what went wrong in words the user can act on, never the server's. */
const toSetupError = (
  plan: AccountPlan,
  side: "incoming" | "outgoing",
  error: MailSendError | MailTransportError
): PasswordAccountError => {
  const provider = findProviderMessages(plan);
  const isIncoming = side === "incoming";

  switch (error._tag) {
    case "MailAuthError": {
      return failWith(
        provider?.passwordRefused ?? PASSWORD_ACCOUNT_MESSAGES.passwordRefused
      );
    }

    case "MailConnectionError": {
      return failWith(
        provider?.unreachable ??
          (isIncoming
            ? PASSWORD_ACCOUNT_MESSAGES.incomingUnreachable
            : PASSWORD_ACCOUNT_MESSAGES.outgoingUnreachable)
      );
    }

    case "MailThrottledError": {
      return failWith(PASSWORD_ACCOUNT_MESSAGES.throttled);
    }

    default: {
      return failWith(
        provider?.unexpected ??
          (isIncoming
            ? PASSWORD_ACCOUNT_MESSAGES.incomingUnexpected
            : PASSWORD_ACCOUNT_MESSAGES.outgoingUnexpected)
      );
    }
  }
};

const isConnected = Effect.fn("isAccountConnected")(function* isConnected(
  accountId: AccountId
) {
  const database = yield* MailDatabase;

  const row = yield* database.use("Could not load accounts", (db) =>
    db.query.mailAccounts.findFirst({
      columns: { accountId: true },
      where: { accountId },
    })
  );

  return row !== undefined;
});

/** Gmail's IMAP extensions, which only Google's servers advertise. */
const GMAIL_CAPABILITY = "X-GM-EXT-1";

/**
 * Signs in over IMAP and lists the mailboxes, as the first sync would. The
 * server decides the dialect: Gmail's labels and thread ids are read only
 * where it advertises them, which also covers Google Workspace domains.
 * `hidden` is why that dialect could not read the account's mail from the
 * mailboxes listed, when it could not.
 */
const verifyIncoming = Effect.fn("verifyIncomingSignIn")(
  function* verifyIncoming(plan: AccountPlan, auth: ImapAuth) {
    const connector = yield* ImapConnector;

    return yield* Effect.scoped(
      Effect.gen(function* listMailboxes() {
        const session = yield* connector.connect({
          accountId: plan.accountId,
          auth,
          server: plan.imap,
        });

        const listed = yield* session.listMailboxes;

        const dialect: DialectKind = session.capabilities.has(GMAIL_CAPABILITY)
          ? "gmail"
          : "generic";

        return { dialect, hidden: dialects[dialect].unreadable?.(listed) };
      })
    ).pipe(Effect.mapError((error) => toSetupError(plan, "incoming", error)));
  }
);

/** Signs in over SMTP and quits; nothing is sent. */
const verifyOutgoing = Effect.fn("verifyOutgoingSignIn")(
  function* verifyOutgoing(plan: AccountPlan, auth: ImapAuth) {
    const smtp = yield* SmtpSignIn;
    yield* smtp
      .verify({ accountId: plan.accountId, auth, server: plan.smtp })
      .pipe(Effect.mapError((error) => toSetupError(plan, "outgoing", error)));
  }
);

/** An account whose servers accepted the sign-in, ready to be saved. */
export interface VerifiedPasswordAccount {
  /** The `safeStorage`-sealed password; the only form that is stored. */
  readonly credentials: Buffer;
  readonly dialect: DialectKind;
  readonly plan: AccountPlan;
}

/**
 * Google shows an app password in groups of four letters. The spaces are only
 * for reading, so they are dropped before Google's servers see it.
 */
const toSignInPassword = (
  plan: AccountPlan,
  password: Redacted.Redacted<string>
): Redacted.Redacted<string> =>
  isGoogleMailHost(plan.imap.host)
    ? Redacted.make(Redacted.value(password).replaceAll(/\s/gu, ""), {
        label: "app password",
      })
    : password;

/**
 * Checks an app password account before anything is saved: the address is
 * not connected yet, both of its servers accept the sign-in, and the
 * password can be sealed with `safeStorage`. Safe to interrupt at any point.
 */
export const verifyPasswordAccount = Effect.fn("verifyPasswordAccount")(
  function* verifyPasswordAccount(request: PasswordAccountSetupRequest) {
    const plan = yield* planAccount(request);
    yield* requireSecureCredentialStorage.pipe(
      Effect.mapError(({ message }) => failWith(message))
    );

    const alreadyConnected = yield* isConnected(plan.accountId).pipe(
      Effect.mapError(() => failWith(PASSWORD_ACCOUNT_MESSAGES.saveFailed))
    );

    if (alreadyConnected) {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.alreadyConnected);
    }

    const password = toSignInPassword(plan, request.password);
    const auth: ImapAuth = { kind: "password", password, user: plan.username };
    const { dialect, hidden } = yield* verifyIncoming(plan, auth);

    if (hidden !== undefined) {
      // Connected like this, the account would sync Spam and Trash alone
      // and report itself complete, with none of its mail.
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.gmailAllMailHidden);
    }

    yield* verifyOutgoing(plan, auth);

    const credentials = yield* encryptPasswordCredentials(password).pipe(
      Effect.mapError(({ message }) => failWith(message))
    );

    return {
      credentials,
      dialect,
      // A Workspace domain set up by hand is still Gmail.
      plan: dialect === "gmail" ? { ...plan, provider: "gmail" } : plan,
    } satisfies VerifiedPasswordAccount;
  }
);

/**
 * Inserts a verified account unless its address was connected meanwhile,
 * then starts its mail. Uninterruptible, so a saved account always starts.
 */
export const savePasswordAccount = Effect.fn("savePasswordAccount")(
  function* savePasswordAccount({
    credentials,
    dialect,
    plan,
  }: VerifiedPasswordAccount) {
    const database = yield* MailDatabase;
    const now = Date.now();

    const inserted = yield* database
      .use("Could not save the account", (db) =>
        db.transaction(async (transaction) => {
          const existing = await transaction
            .select({ accountId: mailAccounts.accountId })
            .from(mailAccounts)
            .where(eq(mailAccounts.accountId, plan.accountId))
            .limit(1)
            .all();

          if (existing.length > 0) {
            return false;
          }

          await transaction
            .insert(mailAccounts)
            .values({
              accountId: plan.accountId,
              createdAt: now,
              credentials,
              dialect,
              displayName: plan.displayName,
              email: plan.email,
              imapHost: plan.imap.host,
              imapPort: plan.imap.port,
              imapSecurity: plan.imap.security,
              provider: plan.provider,
              smtpHost: plan.smtp.host,
              smtpPort: plan.smtp.port,
              smtpSecurity: plan.smtp.security,
              sortOrder: now,
              updatedAt: now,
              username: plan.username,
            })
            .run();

          return true;
        })
      )
      .pipe(
        Effect.mapError(() => failWith(PASSWORD_ACCOUNT_MESSAGES.saveFailed))
      );

    if (!inserted) {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.alreadyConnected);
    }

    notifyAccountConnected(plan.accountId);

    return plan.accountId;
  },
  Effect.uninterruptible
);

/** How a connected account signs in, for signing it in again. */
export type AccountSignInMethod = "microsoft" | "password";

/**
 * The connected account behind an address, if any: its address as stored
 * and how it signs in. The address is matched as accounts are keyed.
 */
export const findAccountSignIn = Effect.fn("findAccountSignIn")(
  function* findAccountSignIn(email: string) {
    const database = yield* MailDatabase;

    const row = yield* database.use("Could not load accounts", (db) =>
      db.query.mailAccounts.findFirst({
        columns: { accountId: true, email: true, provider: true },
        where: { accountId: email.toLowerCase() },
      })
    );

    if (row === undefined) {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.notConnected);
    }

    const method: AccountSignInMethod =
      row.provider === "outlook" ? "microsoft" : "password";

    return {
      accountId: AccountId.make(row.accountId),
      email: row.email,
      method,
    };
  }
);

/** A new app password for a connected account, ready to replace the old one. */
export interface VerifiedPasswordSignIn {
  readonly accountId: AccountId;
  /** The `safeStorage`-sealed password; the only form that is stored. */
  readonly credentials: Buffer;
}

/**
 * Checks a new app password for an account that is already connected. The
 * sign-in uses the account's stored servers, user name and provider, never
 * any the request carries: only the password changes, so the cached mail
 * stays the mail of the same mailbox. A server that now answers as another
 * kind (Gmail or not) is refused, since the cache was built for the old one.
 * Safe to interrupt at any point: nothing is saved here.
 */
export const verifyPasswordSignInAgain = Effect.fn("verifyPasswordSignInAgain")(
  function* verifyPasswordSignInAgain(
    accountId: AccountId,
    password: Redacted.Redacted<string>
  ) {
    yield* requireSecureCredentialStorage.pipe(
      Effect.mapError(({ message }) => failWith(message))
    );
    const database = yield* MailDatabase;

    const stored = yield* database
      .use("Could not load the account", (db) =>
        db.query.mailAccounts.findFirst({ where: { accountId } })
      )
      .pipe(
        Effect.mapError(() => failWith(PASSWORD_ACCOUNT_MESSAGES.saveFailed))
      );

    if (stored === undefined) {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.notConnected);
    }

    if (stored.provider === "outlook") {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.usesMicrosoft);
    }

    const plan = {
      accountId,
      displayName: stored.displayName ?? undefined,
      email: stored.email,
      imap: {
        host: stored.imapHost,
        port: stored.imapPort,
        security: stored.imapSecurity,
      },
      provider: stored.provider,
      smtp: {
        host: stored.smtpHost,
        port: stored.smtpPort,
        security: stored.smtpSecurity,
      },
      username: stored.username,
    } satisfies AccountPlan;

    const signInPassword = toSignInPassword(plan, password);

    const auth: ImapAuth = {
      kind: "password",
      password: signInPassword,
      user: plan.username,
    };

    // Hidden mail does not stand in the way of a new password: the account
    // then says in Settings what to change, with one thing wrong, not two.
    const { dialect } = yield* verifyIncoming(plan, auth);
    yield* verifyOutgoing(plan, auth);

    if (dialect !== stored.dialect) {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.serverChanged);
    }

    const credentials = yield* encryptPasswordCredentials(signInPassword).pipe(
      Effect.mapError(({ message }) => failWith(message))
    );

    return { accountId, credentials } satisfies VerifiedPasswordSignIn;
  }
);

/**
 * Replaces a connected account's app password and starts its mail again. It
 * only ever updates: an account disconnected meanwhile stays disconnected,
 * and nothing is announced for it. Uninterruptible, so a saved sign-in
 * always restarts the account.
 */
export const savePasswordSignInAgain = Effect.fn("savePasswordSignInAgain")(
  function* savePasswordSignInAgain({
    accountId,
    credentials,
  }: VerifiedPasswordSignIn) {
    const database = yield* MailDatabase;

    const updated = yield* database
      .use("Could not save the sign-in", (db) =>
        db
          .update(mailAccounts)
          .set({ credentials, updatedAt: Date.now() })
          .where(
            and(
              eq(mailAccounts.accountId, accountId),
              ne(mailAccounts.provider, "outlook")
            )
          )
          .returning({ accountId: mailAccounts.accountId })
          .all()
      )
      .pipe(
        Effect.mapError(() => failWith(PASSWORD_ACCOUNT_MESSAGES.saveFailed))
      );

    if (updated.length === 0) {
      return yield* failWith(PASSWORD_ACCOUNT_MESSAGES.notConnected);
    }

    notifyAccountConnected(accountId);

    return accountId;
  },
  Effect.uninterruptible
);
