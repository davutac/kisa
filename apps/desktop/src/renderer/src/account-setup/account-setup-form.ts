import type {
  MicrosoftAccountSetupRequest,
  PasswordAccountSetupInput,
} from "@/shared/ipc/account-setup";
import {
  findMailAccountPreset,
  isMailAddress,
  isMailHost,
  isMailPort,
  isMicrosoftConsumerAddress,
  isMicrosoftMailHost,
  MAX_DISPLAY_NAME_LENGTH,
} from "@/shared/mail-account-presets";
import type {
  MailAccountPreset,
  MailAccountServers,
  MailServerSecurity,
} from "@/shared/mail-account-presets";

/**
 * The Add account form as React holds it. The password is deliberately not
 * here: it lives only in its input element until the form is submitted.
 */
export interface ServerFields {
  readonly host: string;
  readonly port: string;
  readonly security: MailServerSecurity;
}

export interface AccountSetupForm {
  readonly email: string;
  readonly imap: ServerFields;
  /** The sender name outgoing mail carries; optional. */
  readonly name: string;
  /**
   * The user asked to sign in with Microsoft for an address Kisa cannot tell
   * is Microsoft's, such as a Microsoft 365 work address on its own domain.
   */
  readonly prefersMicrosoft: boolean;
  readonly smtp: ServerFields;
}

export type ServerSide = "imap" | "smtp";

const DEFAULT_PORTS = {
  imap: { starttls: "143", tls: "993" },
  smtp: { starttls: "587", tls: "465" },
} as const satisfies Record<ServerSide, Record<MailServerSecurity, string>>;

export const INITIAL_ACCOUNT_SETUP_FORM: AccountSetupForm = {
  email: "",
  imap: { host: "", port: DEFAULT_PORTS.imap.tls, security: "tls" },
  name: "",
  prefersMicrosoft: false,
  smtp: { host: "", port: DEFAULT_PORTS.smtp.starttls, security: "starttls" },
};

export type AccountSetupMode =
  /** Not a complete address yet; nothing beyond the address is decided. */
  | { readonly kind: "address" }
  | { readonly kind: "manual" }
  /**
   * Sign in through Microsoft in the browser, with no password or servers.
   * `via` says what decided it: an Outlook.com-family address, the user's
   * choice, or a typed Microsoft server, which takes no passwords at all.
   */
  | {
      readonly kind: "microsoft";
      readonly via: "address" | "choice" | "server";
    }
  | { readonly kind: "preset"; readonly preset: MailAccountPreset };

/**
 * What the form asks for. The address decides first: a preset or one of
 * Microsoft's own domains cannot be overridden. For any other address the
 * user's choice or a Microsoft server decides, even while the address is
 * being edited, so the form does not flicker back to a password.
 */
export const getAccountSetupMode = (
  form: AccountSetupForm
): AccountSetupMode => {
  const address = form.email.trim();
  const isAddress = isMailAddress(address);

  if (isAddress && isMicrosoftConsumerAddress(address)) {
    return { kind: "microsoft", via: "address" };
  }

  const preset = isAddress ? findMailAccountPreset(address) : undefined;
  if (preset !== undefined) {
    return { kind: "preset", preset };
  }
  if (form.prefersMicrosoft) {
    return { kind: "microsoft", via: "choice" };
  }
  if (isMicrosoftMailHost(form.imap.host)) {
    return { kind: "microsoft", via: "server" };
  }
  return isAddress ? { kind: "manual" } : { kind: "address" };
};

export type SignInMethod = "microsoft" | "password";

/**
 * The sign-in the form can switch to from this mode, if any. A typed address
 * may switch to Microsoft when this build can sign in there; a mode the user
 * or a server chose can always switch back. An Outlook.com-family address
 * cannot, since Microsoft refuses passwords for it.
 */
export const findSignInSwitch = (
  mode: AccountSetupMode,
  canSignInWithMicrosoft: boolean
): SignInMethod | undefined => {
  if (mode.kind === "manual") {
    return canSignInWithMicrosoft ? "microsoft" : undefined;
  }
  if (mode.kind === "microsoft" && mode.via !== "address") {
    return "password";
  }
  return undefined;
};

/**
 * Switches how the form signs in. Back to a password also clears a Microsoft
 * server, which would otherwise keep the form on Microsoft.
 */
export const withSignInMethod = (
  form: AccountSetupForm,
  method: SignInMethod
): AccountSetupForm =>
  method === "microsoft"
    ? { ...form, prefersMicrosoft: true }
    : {
        ...form,
        imap: isMicrosoftMailHost(form.imap.host)
          ? { ...form.imap, host: "" }
          : form.imap,
        prefersMicrosoft: false,
      };

/**
 * Switching security moves a port that still holds the old default to the
 * new one, so the usual pairs (993 TLS, 587 STARTTLS) follow the choice.
 */
export const withServerSecurity = (
  side: ServerSide,
  fields: ServerFields,
  security: MailServerSecurity
): ServerFields => ({
  ...fields,
  port:
    fields.port === DEFAULT_PORTS[side][fields.security]
      ? DEFAULT_PORTS[side][security]
      : fields.port,
  security,
});

export type AccountSetupField =
  | "email"
  | "imapHost"
  | "imapPort"
  | "name"
  | "password"
  | "smtpHost"
  | "smtpPort";

export interface AccountSetupProblem {
  readonly field: AccountSetupField;
  readonly message: string;
}

const SERVER_NAMES = {
  imap: "incoming",
  smtp: "outgoing",
} as const satisfies Record<ServerSide, string>;

const toPort = (port: string): number =>
  /^\d{1,5}$/u.test(port.trim()) ? Number(port.trim()) : Number.NaN;

const checkServer = (
  side: ServerSide,
  fields: ServerFields
): AccountSetupProblem | undefined => {
  if (!isMailHost(fields.host.trim())) {
    return {
      field: side === "imap" ? "imapHost" : "smtpHost",
      message: `Enter the ${SERVER_NAMES[side]} server's host name.`,
    };
  }
  if (!isMailPort(toPort(fields.port))) {
    return {
      field: side === "imap" ? "imapPort" : "smtpPort",
      message: `Enter the ${SERVER_NAMES[side]} server's port, from 1 to 65535.`,
    };
  }
  return undefined;
};

// Control characters would break the From header main writes the name into.
const CONTROL_CHARACTER = /\p{Cc}/u;

const checkName = (name: string): AccountSetupProblem | undefined => {
  const trimmed = name.trim();

  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return {
      field: "name",
      message: `Keep the name to ${MAX_DISPLAY_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (CONTROL_CHARACTER.test(trimmed)) {
    return {
      field: "name",
      message: "Remove tabs and line breaks from the name.",
    };
  }
  return undefined;
};

/** The first thing to fix before the form can be sent, in reading order. */
export const findAccountSetupProblem = (
  form: AccountSetupForm,
  hasPassword: boolean
): AccountSetupProblem | undefined => {
  const nameProblem = checkName(form.name);
  if (nameProblem !== undefined) {
    return nameProblem;
  }
  if (!isMailAddress(form.email.trim())) {
    return { field: "email", message: "Enter your email address." };
  }

  const mode = getAccountSetupMode(form);

  // Microsoft takes the password in the browser; this window asks for none.
  if (mode.kind === "microsoft") {
    return undefined;
  }
  if (!hasPassword) {
    return { field: "password", message: "Enter the app password." };
  }
  if (mode.kind === "manual") {
    return checkServer("imap", form.imap) ?? checkServer("smtp", form.smtp);
  }
  return undefined;
};

const toServer = ({ host, port, security }: ServerFields) => ({
  host: host.trim(),
  port: toPort(port),
  security,
});

/**
 * The server settings to send: the trimmed manual fields, and none for a
 * preset or Microsoft, whose settings main applies itself.
 */
export const toAccountServers = (
  form: AccountSetupForm
): MailAccountServers | undefined =>
  getAccountSetupMode(form).kind === "manual"
    ? { imap: toServer(form.imap), smtp: toServer(form.smtp) }
    : undefined;

/** The trimmed sender name, or `undefined` when left blank. */
export const toAccountName = (form: AccountSetupForm): string | undefined => {
  const name = form.name.trim();
  return name.length === 0 ? undefined : name;
};

/** The Microsoft sign-in request: the trimmed address, and the name if given. */
export const toMicrosoftSignIn = (
  form: AccountSetupForm
): MicrosoftAccountSetupRequest => {
  const email = form.email.trim();
  const name = toAccountName(form);
  return name === undefined ? { email } : { email, name };
};

/** The connected account a page signs in again, as main named it. */
export interface SignInAgainTarget {
  readonly email: string;
  readonly method: SignInMethod;
}

/**
 * Whether main opened the page to sign a connected account in again, and
 * for which. Main decides both and checks every submission against them;
 * anything malformed is an ordinary Add account page.
 */
export const readSignInAgain = (
  search: string
): SignInAgainTarget | undefined => {
  const params = new URLSearchParams(search);
  const email = params.get("account");
  const method = params.get("method");
  if (
    email === null ||
    !isMailAddress(email) ||
    (method !== "microsoft" && method !== "password")
  ) {
    return undefined;
  }
  return { email, method };
};

/**
 * The form for signing in again: the address is the account's, and an
 * account on its own domain that signs in with Microsoft says so, since its
 * address alone would ask for a password.
 */
export const createSignInAgainForm = (
  target: SignInAgainTarget
): AccountSetupForm => ({
  ...INITIAL_ACCOUNT_SETUP_FORM,
  email: target.email,
  prefersMicrosoft: target.method === "microsoft",
});

/**
 * What signing in again still needs. Only the password: the account keeps
 * its name and servers, which this page neither shows nor sends.
 */
export const findSignInAgainProblem = (
  target: SignInAgainTarget,
  hasPassword: boolean
): AccountSetupProblem | undefined =>
  target.method === "password" && !hasPassword
    ? { field: "password", message: "Enter the new app password." }
    : undefined;

/** What the form still needs before it can be sent, for either kind of page. */
export const findSetupProblem = (
  form: AccountSetupForm,
  hasPassword: boolean,
  target: SignInAgainTarget | undefined
): AccountSetupProblem | undefined =>
  target === undefined
    ? findAccountSetupProblem(form, hasPassword)
    : findSignInAgainProblem(target, hasPassword);

/** Signing in again offers no other way to sign in than the account's own. */
export const findSetupSignInSwitch = (
  mode: AccountSetupMode,
  canSignInWithMicrosoft: boolean,
  target: SignInAgainTarget | undefined
): SignInMethod | undefined =>
  target === undefined
    ? findSignInSwitch(mode, canSignInWithMicrosoft)
    : undefined;

/**
 * The password sign-in to send. Signing in again it carries the account's
 * address and the password only: main signs in with the stored servers.
 */
export const toPasswordSubmission = (
  form: AccountSetupForm,
  password: string,
  target: SignInAgainTarget | undefined
): PasswordAccountSetupInput =>
  target === undefined
    ? {
        email: form.email.trim(),
        name: toAccountName(form),
        password,
        servers: toAccountServers(form),
      }
    : { email: target.email, password };

/** The Microsoft sign-in to start; signing in again, the address only. */
export const toMicrosoftSubmission = (
  form: AccountSetupForm,
  target: SignInAgainTarget | undefined
): MicrosoftAccountSetupRequest =>
  target === undefined ? toMicrosoftSignIn(form) : { email: target.email };
