import { mailAccounts } from "@repo/database/schemas";
import type { DialectKind } from "@repo/mail/dialects";
import type { MailTransportError } from "@repo/mail/errors";
import { AccountId } from "@repo/mail/ids";
import { ImapConnector } from "@repo/mail/session";
import type { ImapAuth } from "@repo/mail/session";
import type { MailSendError } from "@repo/mail/smtp";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { MicrosoftAccountSetupRequest } from "../../shared/ipc/account-setup";
import { microsoftServersFor } from "../../shared/mail-account-presets";
import type { MailServerSettings } from "../../shared/mail-account-presets";
import { MailDatabase } from "../mail/engine/mail-database";
import { SmtpSignIn } from "../mail/engine/smtp-sign-in";
import { notifyAccountConnected } from "./account-events";
import { requireSecureCredentialStorage } from "./credential-storage";
import { rememberMicrosoftAccessToken } from "./microsoft-access-tokens";
import { getMicrosoftOAuthEnvironment } from "./microsoft-client";
import { signInWithMicrosoft } from "./microsoft-oauth";
import type { MicrosoftSignInError, MicrosoftTokens } from "./microsoft-oauth";
import { sealMicrosoftRefreshToken } from "./sealed-credentials";

/**
 * Every failure the Add account window can show for a Microsoft account.
 * Messages are fixed text: nothing a server or Microsoft's sign-in service
 * said is passed on, and no token is ever part of one.
 */
export const MICROSOFT_ACCOUNT_MESSAGES = {
  alreadyConnected: "This address is already connected with a password.",
  cancelled: "Microsoft sign-in was cancelled.",
  differentAccount:
    "Microsoft signed in a different account than the address you entered. Try again and choose that account.",
  invalidRequest: "Check the email address.",
  mailboxRefused:
    "Outlook would not open this mailbox. Turn on IMAP in Outlook.com under Settings, Mail, Forwarding and IMAP, then try again.",
  notKept: "Microsoft did not let Kisa stay signed in. Try again.",
  refused: "Microsoft did not allow the sign-in. Try again.",
  saveFailed: "Could not save the account.",
  sendingRefused:
    "Outlook lets Kisa read this mailbox but not send from it. A work or school account may have sending from mail apps turned off.",
  startFailed: "Could not start Microsoft sign-in. Try again.",
  throttled: "Outlook is busy. Try again in a few minutes.",
  timeout: "Microsoft sign-in was not finished in time. Try again.",
  unavailable: "This build of Kisa can't sign in to Microsoft accounts.",
  unexpected:
    "Outlook's mail servers did not respond as expected. Try again later.",
  unreachable:
    "Could not reach Microsoft. Check your connection and try again.",
} as const;

// oxlint-disable-next-line unicorn/throw-new-error
export class MicrosoftAccountError extends Schema.TaggedError<
  MicrosoftAccountError,
  { readonly brand: unique symbol }
>()("MicrosoftAccountError", { message: Schema.String }) {}

const failWith = (message: string): MicrosoftAccountError =>
  new MicrosoftAccountError({ message });

const decodeRequest = Schema.decodeUnknownEffect(MicrosoftAccountSetupRequest);

/** Decodes the setup window's request; any issue becomes one fixed message. */
export const decodeMicrosoftAccountRequest = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The setup window's request is decoded here, at the IPC boundary.
  input: unknown
): Effect.Effect<MicrosoftAccountSetupRequest, MicrosoftAccountError> =>
  decodeRequest(input).pipe(
    Effect.mapError(() => failWith(MICROSOFT_ACCOUNT_MESSAGES.invalidRequest))
  );

export interface MicrosoftAccountPlan {
  readonly accountId: AccountId;
  /** The sender name on outgoing mail, if the user gave one. */
  readonly displayName: string | undefined;
  /** Lowercased: the renderer keys accounts by this, as by `accountId`. */
  readonly email: string;
  readonly imap: MailServerSettings;
  readonly smtp: MailServerSettings;
  /** The address as typed, which XOAUTH2 names as the mailbox to open. */
  readonly username: string;
}

const planAccount = (
  request: MicrosoftAccountSetupRequest
): MicrosoftAccountPlan => {
  const email = request.email.toLowerCase();
  const displayName = request.name?.trim();

  return {
    accountId: AccountId.make(email),
    displayName:
      displayName === undefined || displayName.length === 0
        ? undefined
        : displayName,
    email,
    ...microsoftServersFor(email),
    username: request.email,
  };
};

const toSignInError = (error: MicrosoftSignInError): MicrosoftAccountError => {
  switch (error.kind) {
    case "cancelled": {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.cancelled);
    }
    case "local": {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.startFailed);
    }
    case "timeout": {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.timeout);
    }
    case "unavailable": {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.unreachable);
    }
    default: {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.refused);
    }
  }
};

/**
 * Says what went wrong in words the user can act on. A mailbox that refuses
 * a token Microsoft has just issued either has IMAP turned off, the default
 * for a new Outlook.com account, or belongs to another account than the one
 * the browser signed in, which only the sign-in's own answer can tell apart.
 */
const toMailboxError = (
  plan: MicrosoftAccountPlan,
  tokens: MicrosoftTokens,
  side: "incoming" | "outgoing",
  error: MailSendError | MailTransportError
): MicrosoftAccountError => {
  switch (error._tag) {
    case "MailAuthError": {
      if (
        tokens.signedInAs !== undefined &&
        tokens.signedInAs.toLowerCase() !== plan.email
      ) {
        return failWith(MICROSOFT_ACCOUNT_MESSAGES.differentAccount);
      }
      return failWith(
        side === "incoming"
          ? MICROSOFT_ACCOUNT_MESSAGES.mailboxRefused
          : MICROSOFT_ACCOUNT_MESSAGES.sendingRefused
      );
    }
    case "MailConnectionError": {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.unreachable);
    }
    case "MailThrottledError": {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.throttled);
    }
    default: {
      return failWith(MICROSOFT_ACCOUNT_MESSAGES.unexpected);
    }
  }
};

const GMAIL_CAPABILITY = "X-GM-EXT-1";

/** An account Microsoft and its mail servers accepted, ready to be saved. */
export interface VerifiedMicrosoftAccount {
  /** The `safeStorage`-sealed refresh token; the only form that is stored. */
  readonly credentials: Buffer;
  readonly dialect: DialectKind;
  readonly plan: MicrosoftAccountPlan;
  readonly tokens: MicrosoftTokens;
}

/**
 * Signs the user in to Microsoft in the system browser, then checks that the
 * mailbox opens over IMAP and that SMTP accepts the same sign-in, before
 * anything is saved. An address already connected through Microsoft may sign
 * in again, which replaces its sign-in and keeps its cached mail; one
 * connected with a password may not. Safe to interrupt at any point: the
 * browser sign-in's listener closes with it.
 */
export const verifyMicrosoftAccount = Effect.fn("verifyMicrosoftAccount")(
  function* verifyMicrosoftAccount(request: MicrosoftAccountSetupRequest) {
    const environment = getMicrosoftOAuthEnvironment();
    if (environment === undefined) {
      return yield* failWith(MICROSOFT_ACCOUNT_MESSAGES.unavailable);
    }

    const plan = planAccount(request);
    yield* requireSecureCredentialStorage.pipe(
      Effect.mapError(({ message }) => failWith(message))
    );

    const database = yield* MailDatabase;
    const existing = yield* database
      .use("Could not load accounts", (db) =>
        db.query.mailAccounts.findFirst({
          columns: { provider: true },
          where: { accountId: plan.accountId },
        })
      )
      .pipe(
        Effect.mapError(() => failWith(MICROSOFT_ACCOUNT_MESSAGES.saveFailed))
      );
    if (existing !== undefined && existing.provider !== "outlook") {
      return yield* failWith(MICROSOFT_ACCOUNT_MESSAGES.alreadyConnected);
    }

    const tokens = yield* signInWithMicrosoft(environment, plan.username).pipe(
      Effect.mapError(toSignInError)
    );
    const { refreshToken } = tokens;
    if (refreshToken === undefined) {
      return yield* failWith(MICROSOFT_ACCOUNT_MESSAGES.notKept);
    }

    const auth: ImapAuth = {
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      kind: "oauth",
      user: plan.username,
    };
    const connector = yield* ImapConnector;
    const dialect = yield* Effect.scoped(
      Effect.gen(function* listMailboxes() {
        const session = yield* connector.connect({
          accountId: plan.accountId,
          auth,
          server: plan.imap,
        });
        yield* session.listMailboxes;
        return session.capabilities.has(GMAIL_CAPABILITY)
          ? ("gmail" satisfies DialectKind)
          : ("generic" satisfies DialectKind);
      })
    ).pipe(
      Effect.mapError((error) =>
        toMailboxError(plan, tokens, "incoming", error)
      )
    );

    const smtp = yield* SmtpSignIn;
    yield* smtp
      .verify({ accountId: plan.accountId, auth, server: plan.smtp })
      .pipe(
        Effect.mapError((error) =>
          toMailboxError(plan, tokens, "outgoing", error)
        )
      );

    const credentials = yield* sealMicrosoftRefreshToken(refreshToken).pipe(
      Effect.mapError(({ message }) => failWith(message))
    );

    return {
      credentials,
      dialect,
      plan,
      tokens,
    } satisfies VerifiedMicrosoftAccount;
  }
);

/**
 * Saves a verified account and starts its mail: a new address is added, and
 * one already connected through Microsoft has its sign-in replaced.
 * Uninterruptible, so a saved account always starts.
 */
export const saveMicrosoftAccount = Effect.fn("saveMicrosoftAccount")(
  function* saveMicrosoftAccount({
    credentials,
    dialect,
    plan,
    tokens,
  }: VerifiedMicrosoftAccount) {
    const database = yield* MailDatabase;
    const now = Date.now();
    const outcome = yield* database
      .use("Could not save the account", (db) =>
        db.transaction(async (transaction) => {
          const [existing] = await transaction
            .select({ provider: mailAccounts.provider })
            .from(mailAccounts)
            .where(eq(mailAccounts.accountId, plan.accountId))
            .limit(1)
            .all();

          if (existing !== undefined) {
            if (existing.provider !== "outlook") {
              return "conflict" as const;
            }
            await transaction
              .update(mailAccounts)
              .set({ credentials, updatedAt: now })
              .where(eq(mailAccounts.accountId, plan.accountId))
              .run();
            return "replaced" as const;
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
              provider: "outlook",
              smtpHost: plan.smtp.host,
              smtpPort: plan.smtp.port,
              smtpSecurity: plan.smtp.security,
              sortOrder: now,
              updatedAt: now,
              username: plan.username,
            })
            .run();
          return "added" as const;
        })
      )
      .pipe(
        Effect.mapError(() => failWith(MICROSOFT_ACCOUNT_MESSAGES.saveFailed))
      );

    if (outcome === "conflict") {
      return yield* failWith(MICROSOFT_ACCOUNT_MESSAGES.alreadyConnected);
    }

    // The token the servers have just accepted serves the first connection.
    rememberMicrosoftAccessToken(plan.accountId, tokens);
    notifyAccountConnected(plan.accountId);
    return plan.accountId;
  },
  Effect.uninterruptible
);
