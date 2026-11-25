import { isIP } from "node:net";

// What Gmail's receiving servers concluded about a message's sender, read
// from the headers Gmail stores with it. Everything else in a message's
// headers was written by whoever sent it.

/** Gmail payload headers type every field as optional and nullable. */
export interface AuthenticationHeader {
  readonly name?: string | null;
  readonly value?: string | null;
}

export interface GmailAuthentication {
  /** Whether Gmail validated a BIMI record aligned with the sender. */
  readonly bimiPassed: boolean;
  /** The From domain that DMARC authenticated. */
  readonly domain: string;
  /** Whether that domain's DMARC policy is strict enough for BIMI. */
  readonly hasEligibleDmarcPolicy: boolean;
  /** The BIMI selector Gmail reports, or `default`. */
  readonly selector: string;
}

const GMAIL_AUTHSERV_ID_PATTERN = /^\s*mx\.google\.com\s*;/iu;
const SELECTOR_PATTERN = /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u;

export const getHeaderValues = (
  headers: readonly AuthenticationHeader[],
  name: string
): readonly string[] =>
  headers.flatMap((header) =>
    header.name?.toLowerCase() === name &&
    header.value !== undefined &&
    header.value !== null
      ? [header.value]
      : []
  );

export const extractSenderDomain = (from: string): string | null => {
  const angleBracketDomain = from.match(
    /<\s*[^<>\s@]+@(?<domain>[^\s<>,;@"']+)\s*>/u
  )?.groups?.domain;

  const domain = (
    angleBracketDomain ??
    from.match(/@(?<domain>[^\s<>,;@"']+)/u)?.groups?.domain
  )
    ?.replaceAll(/\.+$/gu, "")
    .toLowerCase();

  if (
    domain === undefined ||
    domain.length > 253 ||
    !domain.includes(".") ||
    isIP(domain) !== 0
  ) {
    return null;
  }

  return domain;
};

const isAlignedDomain = (
  domain: string,
  authenticatedDomain: string
): boolean =>
  domain === authenticatedDomain || domain.endsWith(`.${authenticatedDomain}`);

const isAlignedBimiResult = (
  senderDomain: string,
  bimiDomain: string | undefined,
  selector: string
): boolean =>
  bimiDomain !== undefined &&
  selector.length <= 63 &&
  SELECTOR_PATTERN.test(selector) &&
  isAlignedDomain(senderDomain, bimiDomain);

const getBimiAuthentication = (
  authentication: string,
  senderDomain: string
): Pick<GmailAuthentication, "bimiPassed" | "selector"> => {
  const bimiProperties = authentication.match(
    /\bbimi=pass\b(?<properties>[^;]*)/iu
  )?.groups?.properties;

  const bimiDomain = bimiProperties
    ?.match(/\bheader\.d=(?<domain>[^\s;]+)/iu)
    ?.groups?.domain?.toLowerCase();

  const selector =
    bimiProperties
      ?.match(/\bheader\.selector=(?<selector>[^\s;]+)/iu)
      ?.groups?.selector?.toLowerCase() ?? "default";

  return {
    bimiPassed: isAlignedBimiResult(senderDomain, bimiDomain, selector),
    selector,
  };
};

const hasEligibleDmarcPolicy = (dmarcProperties: string): boolean => {
  const policy = dmarcProperties
    .match(/\bp=(?<policy>none|quarantine|reject)\b/iu)
    ?.groups?.policy?.toLowerCase();

  const subdomainPolicy = dmarcProperties
    .match(/\bsp=(?<policy>none|quarantine|reject)\b/iu)
    ?.groups?.policy?.toLowerCase();

  const percentage = dmarcProperties.match(/\bpct=(?<value>\d{1,3})\b/iu)
    ?.groups?.value;

  return (
    subdomainPolicy !== "none" &&
    (policy === "reject" ||
      (policy === "quarantine" &&
        (percentage === undefined || percentage === "100")))
  );
};

/**
 * Reads Gmail's verdict on the sender: an aligned DMARC pass for the From
 * domain in Gmail's own `Authentication-Results`, or `null` without one.
 *
 * Gmail adds that header above every header a message arrives with, so only
 * the topmost `Authentication-Results` can be Gmail's. A sender can write a
 * lookalike lower down, and a message that reached the mailbox without passing
 * Gmail's receiving servers carries no Gmail header at all; reading anything
 * below the top would accept either.
 */
export const getGmailAuthentication = (
  headers: readonly AuthenticationHeader[],
  senderDomain: string
): GmailAuthentication | null => {
  const [authentication] = getHeaderValues(headers, "authentication-results");

  if (
    authentication === undefined ||
    !GMAIL_AUTHSERV_ID_PATTERN.test(authentication)
  ) {
    return null;
  }

  const dmarcProperties = authentication.match(
    /\bdmarc=pass\b(?<properties>[^;]*)/iu
  )?.groups?.properties;

  const authenticatedFrom = dmarcProperties
    ?.match(/\bheader\.from=(?<domain>[^\s;]+)/iu)
    ?.groups?.domain?.toLowerCase();

  if (
    dmarcProperties === undefined ||
    authenticatedFrom === undefined ||
    !isAlignedDomain(senderDomain, authenticatedFrom)
  ) {
    return null;
  }

  return {
    ...getBimiAuthentication(authentication, senderDomain),
    domain: authenticatedFrom,
    hasEligibleDmarcPolicy: hasEligibleDmarcPolicy(dmarcProperties),
  };
};

/** Whether Gmail authenticated the domain of this From address. */
export const isAuthenticatedSender = (
  from: string,
  headers: readonly AuthenticationHeader[]
): boolean => {
  const senderDomain = extractSenderDomain(from);

  return (
    senderDomain !== null &&
    getGmailAuthentication(headers, senderDomain) !== null
  );
};
