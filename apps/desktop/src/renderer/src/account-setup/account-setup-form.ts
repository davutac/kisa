import type {
  MicrosoftAccountSetupRequest,
  PasswordAccountSetupInput,
} from "@/shared/ipc/account-setup";
import {
  findMailAccountPreset,
  HOSTED_MAIL_PRESETS,
  isMailAddress,
  isMailHost,
  isMailPort,
  isMicrosoftConsumerAddress,
  isMicrosoftMailHost,
  MAX_DISPLAY_NAME_LENGTH,
  toAddressDomain,
} from "@/shared/mail-account-presets";
import type {
  HostedMailProvider,
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

/** What main answered about one domain: who hosts its mail, if Kisa knows. */
export interface DomainLookup {
  readonly domain: string;
  readonly provider: HostedMailProvider | undefined;
}

export interface AccountSetupForm {
  /**
   * The last domain main looked up. An answer for another domain than the
   * address's is stale and counts as none, so a late reply cannot decide.
   */
  readonly domainLookup: DomainLookup | undefined;
  readonly email: string;
  readonly imap: ServerFields;
  /** The sender name outgoing mail carries; optional. */
  readonly name: string;
  /**
   * The user asked to sign in with Microsoft for an address Kisa cannot tell
   * is Microsoft's, such as a Microsoft 365 work address on its own domain.
   */
  readonly prefersMicrosoft: boolean;
  /**
   * The user asked to enter servers for a domain whose mail Google hosts,
   * for a mailbox that lives elsewhere.
   */
  readonly prefersServers: boolean;
  readonly smtp: ServerFields;
}

export type ServerSide = "imap" | "smtp";

const DEFAULT_PORTS = {
  imap: { starttls: "143", tls: "993" },
  smtp: { starttls: "587", tls: "465" },
} as const satisfies Record<ServerSide, Record<MailServerSecurity, string>>;

export const INITIAL_ACCOUNT_SETUP_FORM: AccountSetupForm = {
  domainLookup: undefined,
  email: "",
  imap: { host: "", port: DEFAULT_PORTS.imap.tls, security: "tls" },
  name: "",
  prefersMicrosoft: false,
  prefersServers: false,
  smtp: { host: "", port: DEFAULT_PORTS.smtp.starttls, security: "starttls" },
};

export type AccountSetupMode =
  /** Not a complete address yet; nothing beyond the address is decided. */
  | { readonly kind: "address" }
  /** Main is still saying who hosts the address's domain. */
  | { readonly kind: "lookup" }
  /**
   * Servers entered by hand. `hosted` is the preset the user set aside for
   * them, which they can go back to.
   */
  | { readonly hosted?: MailAccountPreset; readonly kind: "manual" }
  /**
   * Sign in through Microsoft in the browser, with no password or servers.
   * `via` says what decided it: an Outlook.com-family address, the user's
   * choice, or a typed Microsoft server, which takes no passwords at all.
   */
  | {
      readonly kind: "microsoft";
      readonly via: "address" | "choice" | "server";
    }
  /**
   * A known provider's servers. `via` says what decided it: the address's
   * own domain, or a custom domain whose mail the provider hosts.
   */
  | {
      readonly kind: "preset";
      readonly preset: MailAccountPreset;
      readonly via: "address" | "domain";
    };

/** Who main said hosts the address's domain, once it has said. */
const findDomainLookup = (
  form: AccountSetupForm,
  address: string
): DomainLookup | undefined =>
  form.domainLookup !== undefined &&
  form.domainLookup.domain === toAddressDomain(address)
    ? form.domainLookup
    : undefined;

/**
 * The domain to ask main about, or `undefined` when the form can decide
 * without it: an incomplete address, a preset, one of Microsoft's own
 * domains, or a domain already answered.
 */
export const findDomainToLookUp = (
  form: AccountSetupForm
): string | undefined => {
  const address = form.email.trim();
  if (
    !isMailAddress(address) ||
    isMicrosoftConsumerAddress(address) ||
    findMailAccountPreset(address) !== undefined ||
    findDomainLookup(form, address) !== undefined
  ) {
    return undefined;
  }
  return toAddressDomain(address);
};

/** Records main's answer for a domain, replacing any earlier one. */
export const withDomainLookup = (
  form: AccountSetupForm,
  lookup: DomainLookup
): AccountSetupForm => ({ ...form, domainLookup: lookup });

/**
 * What the form asks for. The address decides first: a preset or one of
 * Microsoft's own domains cannot be overridden. For any other address the
 * user's choice or a Microsoft server decides, even while the address is
 * being edited, so the form does not flicker back to a password. Then who
 * hosts the domain decides, once main has said, unless the user chose to
 * enter servers.
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
    return { kind: "preset", preset, via: "address" };
  }
  if (form.prefersMicrosoft) {
    return { kind: "microsoft", via: "choice" };
  }
  if (isMicrosoftMailHost(form.imap.host)) {
    return { kind: "microsoft", via: "server" };
  }
  if (!isAddress) {
    return { kind: "address" };
  }

  const lookup = findDomainLookup(form, address);
  const hosted =
    lookup?.provider === undefined
      ? undefined
      : HOSTED_MAIL_PRESETS[lookup.provider];
  if (form.prefersServers) {
    return hosted === undefined
      ? { kind: "manual" }
      : { hosted, kind: "manual" };
  }
  if (lookup === undefined) {
    return { kind: "lookup" };
  }
  return hosted === undefined
    ? { kind: "manual" }
    : { kind: "preset", preset: hosted, via: "domain" };
};

export type SignInMethod = "microsoft" | "password";

/**
 * What the switch under the address changes to: a way to sign in, or, for a
 * domain whose mail a known provider hosts, servers typed by hand (`servers`)
 * or that provider's again (`hosted`).
 */
export type SetupSwitch = SignInMethod | "hosted" | "servers";

/**
 * What the form can switch to from this mode, if anything. A domain a known
 * provider hosts can switch to typed servers and back. Any other typed
 * address may switch to Microsoft when this build can sign in there; a mode
 * the user or a server chose can always switch back. An Outlook.com-family
 * address cannot, since Microsoft refuses passwords for it.
 */
export const findSignInSwitch = (
  mode: AccountSetupMode,
  canSignInWithMicrosoft: boolean
): SetupSwitch | undefined => {
  if (mode.kind === "preset") {
    return mode.via === "domain" ? "servers" : undefined;
  }
  if (mode.kind === "manual") {
    if (mode.hosted !== undefined) {
      return "hosted";
    }
    return canSignInWithMicrosoft ? "microsoft" : undefined;
  }
  if (mode.kind === "microsoft" && mode.via !== "address") {
    return "password";
  }
  return undefined;
};

/**
 * Applies the switch under the address. Back to a password also clears a
 * Microsoft server, which would otherwise keep the form on Microsoft.
 */
export const withSignInMethod = (
  form: AccountSetupForm,
  method: SetupSwitch
): AccountSetupForm => {
  if (method === "hosted" || method === "servers") {
    return { ...form, prefersServers: method === "servers" };
  }
  if (method === "microsoft") {
    return { ...form, prefersMicrosoft: true };
  }
  return {
    ...form,
    imap: isMicrosoftMailHost(form.imap.host)
      ? { ...form.imap, host: "" }
      : form.imap,
    prefersMicrosoft: false,
  };
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
  // Sending now would leave main to guess the servers; the answer is near.
  if (mode.kind === "lookup") {
    return {
      field: "email",
      message: "Still finding your mail provider’s settings.",
    };
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
 * The server settings to send: the trimmed manual fields, or a hosted
 * domain's provider's, which main checks as if they were typed. None for an
 * address's own preset or Microsoft, whose settings main applies itself.
 */
export const toAccountServers = (
  form: AccountSetupForm
): MailAccountServers | undefined => {
  const mode = getAccountSetupMode(form);
  if (mode.kind === "manual") {
    return { imap: toServer(form.imap), smtp: toServer(form.smtp) };
  }
  if (mode.kind === "preset" && mode.via === "domain") {
    return { imap: mode.preset.imap, smtp: mode.preset.smtp };
  }
  return undefined;
};

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
): SetupSwitch | undefined =>
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
