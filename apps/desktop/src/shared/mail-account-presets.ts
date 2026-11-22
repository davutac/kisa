/**
 * Server settings for the accounts Kisa connects, all of which sign in with
 * an app password. Presets are keyed by the address's domain and need no
 * network lookup; any other domain is set up by hand. Shared by main, which
 * decides, and the setup window, which only uses them to choose which fields
 * to show.
 */

import type { AccountProvider } from "./ipc/accounts";

export type MailServerSecurity = "starttls" | "tls";

export interface MailServerSettings {
  readonly host: string;
  readonly port: number;
  readonly security: MailServerSecurity;
}

export interface MailAccountServers {
  readonly imap: MailServerSettings;
  readonly smtp: MailServerSettings;
}

export interface MailAccountPreset extends MailAccountServers {
  /** Where the provider's users create the app password Kisa signs in with. */
  readonly appPasswordUrl: string;
  readonly provider: "gmail" | "icloud";
  /** The provider's name as the setup window shows it. */
  readonly title: string;
}

/** Google's settings for Gmail over IMAP and SMTP. */
const GMAIL_PRESET: MailAccountPreset = {
  appPasswordUrl: "https://myaccount.google.com/apppasswords",
  imap: { host: "imap.gmail.com", port: 993, security: "tls" },
  provider: "gmail",
  smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
  title: "Gmail",
};

/** Apple's documented settings for iCloud Mail. */
const ICLOUD_PRESET: MailAccountPreset = {
  appPasswordUrl: "https://support.apple.com/en-us/102654",
  imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
  provider: "icloud",
  smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  title: "iCloud",
};

const PRESETS_BY_DOMAIN: ReadonlyMap<string, MailAccountPreset> = new Map([
  ["gmail.com", GMAIL_PRESET],
  ["googlemail.com", GMAIL_PRESET],
  ["icloud.com", ICLOUD_PRESET],
  ["mac.com", ICLOUD_PRESET],
  ["me.com", ICLOUD_PRESET],
]);

/** Every page a preset links to. */
export const APP_PASSWORD_URLS: ReadonlySet<string> = new Set(
  [GMAIL_PRESET, ICLOUD_PRESET].map(({ appPasswordUrl }) => appPasswordUrl)
);

/**
 * Microsoft's own address families (Outlook.com, Hotmail, Live, MSN), told by
 * the first label of the domain so `outlook.de` and `hotmail.co.uk` count.
 * Since September 2024 they take no passwords from mail apps over IMAP or
 * SMTP, only Microsoft sign-in.
 */
const MICROSOFT_CONSUMER_NAMES: ReadonlySet<string> = new Set([
  "hotmail",
  "live",
  "msn",
  "outlook",
  "passport",
  "windowslive",
]);

export const isMicrosoftConsumerAddress = (address: string): boolean => {
  const domain = toAddressDomain(address);
  const [name = ""] = domain?.split(".") ?? [];
  return (
    domain !== undefined &&
    domain.includes(".") &&
    MICROSOFT_CONSUMER_NAMES.has(name)
  );
};

/**
 * Microsoft's servers. Outlook.com and Microsoft 365 share one IMAP host and
 * differ in where they take outgoing mail.
 */
export const microsoftServersFor = (address: string): MailAccountServers => ({
  imap: { host: "outlook.office365.com", port: 993, security: "tls" },
  smtp: {
    host: isMicrosoftConsumerAddress(address)
      ? "smtp-mail.outlook.com"
      : "smtp.office365.com",
    port: 587,
    security: "starttls",
  },
});

/** Whether a server is Microsoft's, which signs in through Microsoft only. */
export const isMicrosoftMailHost = (host: string): boolean => {
  const name = host.trim().toLowerCase();
  return name === "outlook.office365.com" || name.endsWith(".outlook.com");
};

/** Where Microsoft explains turning IMAP on for an Outlook.com mailbox. */
export const OUTLOOK_IMAP_HELP_URL =
  "https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040";

/** Every page the setup window links to, the only ones it may open. */
export const ACCOUNT_SETUP_HELP_URLS: ReadonlySet<string> = new Set([
  ...APP_PASSWORD_URLS,
  OUTLOOK_IMAP_HELP_URL,
]);

/** Whether a server is Gmail's, which also serves Google Workspace domains. */
export const isGoogleMailHost = (host: string): boolean =>
  host.trim().toLowerCase() === GMAIL_PRESET.imap.host;

/**
 * Whose service an account is on, for its icon. The stored provider comes
 * from the address's preset, so a Google Workspace or iCloud+ custom domain
 * is stored as plain `imap`; its server still says whose it is.
 */
export const toAccountProvider = ({
  imapHost,
  provider,
}: {
  readonly imapHost: string;
  readonly provider: AccountProvider;
}): AccountProvider => {
  if (provider !== "imap") {
    return provider;
  }
  const host = imapHost.trim().toLowerCase();
  if (host === GMAIL_PRESET.imap.host) {
    return "gmail";
  }
  return host === ICLOUD_PRESET.imap.host ? "icloud" : "imap";
};

/**
 * A plain `local@domain.tld` address. Both halves are matched by classes the
 * other cannot claim, so the check stays linear in its input.
 */
const ADDRESS_PATTERN = /^[^\s@"<>]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/iu;
/** A DNS name or IPv4 address. */
const HOST_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/iu;

export const MAX_ADDRESS_LENGTH = 254;
export const MAX_HOST_LENGTH = 253;
export const MAX_PASSWORD_LENGTH = 1024;
export const MAX_DISPLAY_NAME_LENGTH = 128;

export const isMailAddress = (address: string): boolean =>
  address.length <= MAX_ADDRESS_LENGTH && ADDRESS_PATTERN.test(address);

export const isMailHost = (host: string): boolean =>
  host.length <= MAX_HOST_LENGTH && HOST_PATTERN.test(host);

export const isMailPort = (port: number): boolean =>
  Number.isSafeInteger(port) && port >= 1 && port <= 65_535;

/** The lowercased domain of an address, or `undefined` when it has none. */
export const toAddressDomain = (address: string): string | undefined => {
  const at = address.lastIndexOf("@");
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return at === -1 || domain.length === 0 ? undefined : domain;
};

export const findMailAccountPreset = (
  address: string
): MailAccountPreset | undefined => {
  const domain = toAddressDomain(address);
  return domain === undefined ? undefined : PRESETS_BY_DOMAIN.get(domain);
};
