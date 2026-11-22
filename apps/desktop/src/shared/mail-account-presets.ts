/**
 * Server settings for accounts that sign in with an app password. Presets are
 * keyed by the address's domain and need no network lookup; any other domain
 * is set up by hand. Shared by main, which decides, and the setup window,
 * which only uses them to choose which fields to show.
 */

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
  readonly provider: "icloud";
  /** The provider's name as the setup window shows it. */
  readonly title: string;
}

/** Apple's documented settings for iCloud Mail. */
const ICLOUD_PRESET: MailAccountPreset = {
  imap: { host: "imap.mail.me.com", port: 993, security: "tls" },
  provider: "icloud",
  smtp: { host: "smtp.mail.me.com", port: 587, security: "starttls" },
  title: "iCloud",
};

const PRESETS_BY_DOMAIN: ReadonlyMap<string, MailAccountPreset> = new Map([
  ["icloud.com", ICLOUD_PRESET],
  ["mac.com", ICLOUD_PRESET],
  ["me.com", ICLOUD_PRESET],
]);

/**
 * Gmail's folders are label views of All Mail, which only the Gmail dialect
 * understands, so Gmail connects through Google sign-in instead.
 */
const GOOGLE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
]);

/** Where Apple explains app-specific passwords. */
export const APPLE_APP_PASSWORD_GUIDE_URL =
  "https://support.apple.com/en-us/102654";

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

export const isGoogleMailAddress = (address: string): boolean => {
  const domain = toAddressDomain(address);
  return domain !== undefined && GOOGLE_MAIL_DOMAINS.has(domain);
};
