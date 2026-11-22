import {
  findMailAccountPreset,
  isMailAddress,
  isMailHost,
  isMailPort,
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
  smtp: { host: "", port: DEFAULT_PORTS.smtp.starttls, security: "starttls" },
};

export type AccountSetupMode =
  /** Not a complete address yet; nothing beyond the address is decided. */
  | { readonly kind: "address" }
  | { readonly kind: "manual" }
  | { readonly kind: "preset"; readonly preset: MailAccountPreset };

/** What the form asks for, decided by the address's domain alone. */
export const getAccountSetupMode = (email: string): AccountSetupMode => {
  const address = email.trim();

  if (!isMailAddress(address)) {
    return { kind: "address" };
  }

  const preset = findMailAccountPreset(address);
  return preset === undefined ? { kind: "manual" } : { kind: "preset", preset };
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

  const mode = getAccountSetupMode(form.email);

  if (mode.kind === "address") {
    return { field: "email", message: "Enter your email address." };
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
 * The server settings to send: none for a preset, whose settings main
 * applies itself, and the trimmed manual fields otherwise.
 */
export const toAccountServers = (
  form: AccountSetupForm
): MailAccountServers | undefined =>
  getAccountSetupMode(form.email).kind === "manual"
    ? { imap: toServer(form.imap), smtp: toServer(form.smtp) }
    : undefined;

/** The trimmed sender name, or `undefined` when left blank. */
export const toAccountName = (form: AccountSetupForm): string | undefined => {
  const name = form.name.trim();
  return name.length === 0 ? undefined : name;
};
