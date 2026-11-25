import type {
  MicrosoftAccountSetupRequest,
  PasswordAccountSetupInput,
} from "@/shared/ipc/account-setup";
import type { AccountProvider } from "@/shared/ipc/accounts";
import {
  findMailAccountPreset,
  isMailAddress,
  isMailHost,
  isMailPort,
  isMicrosoftConsumerAddress,
  isMicrosoftMailHost,
  MAIL_ACCOUNT_PRESETS,
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

/**
 * The provider the user picked on the window's first step. `imap` is any
 * other provider, whose servers the user types.
 */
export type SetupProvider = AccountProvider;

export interface AccountSetupForm {
  readonly email: string;
  readonly imap: ServerFields;
  /** The sender name outgoing mail carries; optional. */
  readonly name: string;
  /** `undefined` until the user picks a provider, which the window asks first. */
  readonly provider: SetupProvider | undefined;
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
  provider: undefined,
  smtp: { host: "", port: DEFAULT_PORTS.smtp.starttls, security: "starttls" },
};

export type AccountSetupMode =
  /** Other: servers typed by hand. */
  | { readonly kind: "manual" }
  /**
   * Outlook: sign in through Microsoft in the browser, with no password or
   * servers. `via` says whether the address is an Outlook.com-family one,
   * which has IMAP off by default, or any other, such as Microsoft 365.
   */
  | { readonly kind: "microsoft"; readonly via: "address" | "provider" }
  /**
   * Gmail or Apple: the provider's own servers. `via` says whether the
   * address is on the provider's own domain, whose servers main applies
   * itself, or a custom domain the user picked the provider for.
   */
  | {
      readonly kind: "preset";
      readonly preset: MailAccountPreset;
      readonly via: "address" | "provider";
    };

/**
 * What the form asks for, decided by the provider alone so the form keeps
 * its shape while the address is typed. An address of another provider is
 * a problem for `findProviderMismatch`, not a change of form.
 */
export const getAccountSetupMode = (
  provider: SetupProvider,
  email: string
): AccountSetupMode => {
  if (provider === "imap") {
    return { kind: "manual" };
  }
  const address = email.trim();
  const isAddress = isMailAddress(address);
  if (provider === "outlook") {
    return {
      kind: "microsoft",
      via:
        isAddress && isMicrosoftConsumerAddress(address)
          ? "address"
          : "provider",
    };
  }
  const preset = MAIL_ACCOUNT_PRESETS[provider];
  const isOwnAddress =
    isAddress && findMailAccountPreset(address)?.provider === provider;
  return { kind: "preset", preset, via: isOwnAddress ? "address" : "provider" };
};

export type SignInMethod = "microsoft" | "password";

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

/** What the setup window calls each provider, on its first step. */
export const SETUP_PROVIDER_NAMES = {
  gmail: "Gmail",
  icloud: "Apple",
  imap: "Other",
  outlook: "Outlook",
} as const satisfies Record<SetupProvider, string>;

const ADDRESS_NAMES = {
  gmail: "a Gmail",
  icloud: "an iCloud",
  outlook: "a Microsoft",
} as const satisfies Record<Exclude<SetupProvider, "imap">, string>;

/** Which named provider an address belongs to by its domain alone. */
const findAddressProvider = (
  address: string
): Exclude<SetupProvider, "imap"> | undefined => {
  const preset = findMailAccountPreset(address);
  if (preset !== undefined) {
    return preset.provider;
  }
  return isMicrosoftConsumerAddress(address) ? "outlook" : undefined;
};

/**
 * An address the picked provider cannot sign in. Main takes a preset
 * address's own servers whatever the window sends, so a Gmail address under
 * Apple or Other would quietly sign in to Google; it is refused here
 * instead, naming the provider to pick. Apple takes only its own domains,
 * the only ones Kisa has checked against Apple's servers; an iCloud+ custom
 * domain goes through Other, where its servers are typed and checked.
 */
const findProviderMismatch = (
  provider: SetupProvider,
  address: string
): AccountSetupProblem | undefined => {
  const owner = findAddressProvider(address);
  if (owner !== undefined && owner !== provider) {
    return {
      field: "email",
      message: `This is ${ADDRESS_NAMES[owner]} address. Go back and choose ${SETUP_PROVIDER_NAMES[owner]}.`,
    };
  }
  if (provider === "icloud" && owner === undefined) {
    return {
      field: "email",
      message:
        "Enter an iCloud address, such as name@icloud.com. For another domain, go back and choose Other.",
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

/** Other's servers, then whether they are Microsoft's, which take no passwords. */
const checkServers = (
  form: AccountSetupForm
): AccountSetupProblem | undefined => {
  const problem =
    checkServer("imap", form.imap) ?? checkServer("smtp", form.smtp);
  if (problem !== undefined) {
    return problem;
  }
  return isMicrosoftMailHost(form.imap.host)
    ? {
        field: "imapHost",
        message:
          "Microsoft’s servers take no passwords. Go back and choose Outlook.",
      }
    : undefined;
};

/** The first thing to fix before the form can be sent, in reading order. */
export const findAccountSetupProblem = (
  form: AccountSetupForm,
  provider: SetupProvider,
  hasPassword: boolean
): AccountSetupProblem | undefined => {
  const nameProblem = checkName(form.name);
  if (nameProblem !== undefined) {
    return nameProblem;
  }
  const address = form.email.trim();
  if (!isMailAddress(address)) {
    return { field: "email", message: "Enter your email address." };
  }
  const mismatch = findProviderMismatch(provider, address);
  if (mismatch !== undefined) {
    return mismatch;
  }
  // Microsoft takes the password in the browser; this window asks for none.
  if (provider === "outlook") {
    return undefined;
  }
  if (!hasPassword) {
    return { field: "password", message: "Enter the app password." };
  }
  return provider === "imap" ? checkServers(form) : undefined;
};

const toServer = ({ host, port, security }: ServerFields) => ({
  host: host.trim(),
  port: toPort(port),
  security,
});

/**
 * The server settings to send: Other's typed ones, trimmed, or the picked
 * provider's for a custom domain, which main checks as if they were typed.
 * None for an address's own preset or Microsoft, whose settings main
 * applies itself.
 */
export const toAccountServers = (
  form: AccountSetupForm,
  provider: SetupProvider
): MailAccountServers | undefined => {
  const mode = getAccountSetupMode(provider, form.email);
  if (mode.kind === "manual") {
    return { imap: toServer(form.imap), smtp: toServer(form.smtp) };
  }
  if (mode.kind === "preset" && mode.via === "provider") {
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
 * The form for signing in again: the address is the account's, and it
 * skips the providers. How the account signs in picks one: Microsoft is
 * Outlook, and a password account is its address's preset, for the
 * preset's password wording, or Other, whose servers the page never shows.
 */
export const createSignInAgainForm = (
  target: SignInAgainTarget
): AccountSetupForm => ({
  ...INITIAL_ACCOUNT_SETUP_FORM,
  email: target.email,
  provider:
    target.method === "microsoft"
      ? "outlook"
      : (findMailAccountPreset(target.email)?.provider ?? "imap"),
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
  provider: SetupProvider,
  hasPassword: boolean,
  target: SignInAgainTarget | undefined
): AccountSetupProblem | undefined =>
  target === undefined
    ? findAccountSetupProblem(form, provider, hasPassword)
    : findSignInAgainProblem(target, hasPassword);

/**
 * The password sign-in to send. Signing in again it carries the account's
 * address and the password only: main signs in with the stored servers.
 */
export const toPasswordSubmission = (
  form: AccountSetupForm,
  provider: SetupProvider,
  password: string,
  target: SignInAgainTarget | undefined
): PasswordAccountSetupInput =>
  target === undefined
    ? {
        email: form.email.trim(),
        name: toAccountName(form),
        password,
        servers: toAccountServers(form, provider),
      }
    : { email: target.email, password };

/** The Microsoft sign-in to start; signing in again, the address only. */
export const toMicrosoftSubmission = (
  form: AccountSetupForm,
  target: SignInAgainTarget | undefined
): MicrosoftAccountSetupRequest =>
  target === undefined ? toMicrosoftSignIn(form) : { email: target.email };
