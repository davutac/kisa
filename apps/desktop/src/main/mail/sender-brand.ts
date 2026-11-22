import { lookup, resolveTxt } from "node:dns/promises";
import { get as httpsGet } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

import { mailSenderBrands } from "@repo/database/schemas";
import { Effect, Option, Schema } from "effect";
import { getDomain } from "tldts";

import type { MailSenderBrand } from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import {
  extractSenderDomain,
  getGmailAuthentication,
  getHeaderValues,
} from "./sender-authentication";

const AVAILABLE_TTL_MS = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;
const MAX_INDICATOR_BYTES = 512 * 1024;
const MAX_REDIRECTS = 2;
const DnsError = Schema.Struct({ code: Schema.optional(Schema.String) });
const decodeDnsError = Schema.decodeUnknownOption(DnsError);

export interface MessageHeader {
  readonly name: string;
  readonly value: string;
}

export interface SenderBrandRequest {
  /**
   * Whether a missing logo may be looked up. Discovery queries the sender's
   * own DNS and fetches from a host their record names, which tells them the
   * message was opened, so it waits for the same consent as remote images.
   * Without it, only a logo already in the cache can be returned.
   */
  readonly allowDiscovery: boolean;
  readonly from: string;
  readonly headers: readonly MessageHeader[];
}

export interface BimiDiscoveryTarget {
  readonly authorDomain: string;
  readonly selector: string;
}

interface BimiLocation {
  readonly authorityUrl?: string;
  readonly logoUrl: string;
}

interface ResolvedSenderBrand {
  readonly authorityUrl?: string;
  readonly logoData: Buffer;
  readonly logoUrl?: string;
}

interface CachedSenderBrand {
  readonly brand: MailSenderBrand | null;
}

type SenderBrandDiscovery =
  | { readonly status: "invalid" | "missing" }
  | {
      readonly resolved: ResolvedSenderBrand;
      readonly status: "available";
    };

// oxlint-disable-next-line unicorn/throw-new-error
export class SenderBrandError extends Schema.TaggedError<SenderBrandError>()(
  "SenderBrandError",
  { message: Schema.String }
) {}

const isValidSelector = (selector: string): boolean =>
  selector.length <= 253 &&
  selector
    .split(".")
    .every(
      (label) =>
        label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/u.test(label)
    );

export const parseBimiSelector = (value: string): string | null => {
  const entries = value.split(";").map((entry) => entry.trim());

  if (entries[0] !== "v=BIMI1") {
    return null;
  }

  const selectorEntries = entries.slice(1).filter((entry) => entry.length > 0);

  if (selectorEntries.length !== 1) {
    return null;
  }

  const [selectorEntry] = selectorEntries;
  const selector = selectorEntry
    ?.match(/^s=(?<selector>[^=]+)$/u)
    ?.groups?.selector?.trim()
    .toLowerCase();

  return selector !== undefined && isValidSelector(selector) ? selector : null;
};

export const getBimiDiscoveryTarget = (
  headers: readonly MessageHeader[],
  senderDomain: string
): BimiDiscoveryTarget | null => {
  const authentication = getGmailAuthentication(headers, senderDomain);

  if (authentication === null) {
    return null;
  }

  if (authentication.bimiPassed) {
    return { authorDomain: senderDomain, selector: authentication.selector };
  }

  if (!authentication.hasEligibleDmarcPolicy) {
    return null;
  }

  const selectorHeaders = getHeaderValues(headers, "bimi-selector");

  if (selectorHeaders.length > 1) {
    return null;
  }

  const [selectorHeader] = selectorHeaders;
  const selector =
    selectorHeader === undefined
      ? "default"
      : parseBimiSelector(selectorHeader);

  return selector === null ? null : { authorDomain: senderDomain, selector };
};

export const getBimiLookupDomains = (
  authorDomain: string
): readonly string[] => {
  const organizationalDomain = getDomain(authorDomain, {
    allowPrivateDomains: false,
  });

  return organizationalDomain === null || organizationalDomain === authorDomain
    ? [authorDomain]
    : [authorDomain, organizationalDomain];
};

/**
 * A cheap hint used before re-reading a new message's authentication headers.
 * The cached logo is never returned from this check: `getSenderBrand` still
 * validates the new message before a notification may display it.
 */
export const hasCachedSenderBrand = Effect.fn("hasCachedSenderBrand")(
  function* hasCachedSenderBrand(from: string) {
    const senderDomain = extractSenderDomain(from);

    if (senderDomain === null) {
      return false;
    }

    const domains = getBimiLookupDomains(senderDomain);
    const rows = yield* withDatabaseClient((database) =>
      database.query.mailSenderBrands.findMany({
        where: {
          domain: { in: [...domains] },
          expiresAt: { gt: Date.now() },
          status: "available",
        },
      })
    ).pipe(
      Effect.mapError(
        () => new SenderBrandError({ message: "Could not load sender brand" })
      )
    );

    return rows.some((row) => row.logoData !== null);
  }
);

const parseHttpsUrl = (value: string | undefined): string | null => {
  if (value === undefined) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.hostname.length === 0
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

export const parseBimiLocation = (value: string): BimiLocation | null => {
  const entries = value.split(";").map((entry) => entry.trim());

  if (entries[0] !== "v=BIMI1") {
    return null;
  }

  const tags = new Map<string, string>();

  for (const entry of entries.slice(1)) {
    if (entry.length === 0) {
      continue;
    }

    const separatorIndex = entry.indexOf("=");

    if (separatorIndex <= 0) {
      return null;
    }

    tags.set(
      entry.slice(0, separatorIndex).trim(),
      entry.slice(separatorIndex + 1).trim()
    );
  }

  const logoUrl = parseHttpsUrl(tags.get("l"));

  if (logoUrl === null) {
    return null;
  }

  const authorityValue = tags.get("a");
  const authorityUrl =
    authorityValue === undefined || authorityValue.length === 0
      ? null
      : parseHttpsUrl(authorityValue);

  if (
    authorityValue !== undefined &&
    authorityValue.length > 0 &&
    authorityUrl === null
  ) {
    return null;
  }

  return authorityUrl === null ? { logoUrl } : { authorityUrl, logoUrl };
};

const BLOCKED_IPV4_RANGES = [
  [0x00_00_00_00, 0x00_ff_ff_ff],
  [0x0a_00_00_00, 0x0a_ff_ff_ff],
  [0x64_40_00_00, 0x64_7f_ff_ff],
  [0x7f_00_00_00, 0x7f_ff_ff_ff],
  [0xa9_fe_00_00, 0xa9_fe_ff_ff],
  [0xac_10_00_00, 0xac_1f_ff_ff],
  [0xc0_00_00_00, 0xc0_00_00_ff],
  [0xc0_00_02_00, 0xc0_00_02_ff],
  [0xc0_58_63_00, 0xc0_58_63_ff],
  [0xc0_a8_00_00, 0xc0_a8_ff_ff],
  [0xc6_12_00_00, 0xc6_13_ff_ff],
  [0xc6_33_64_00, 0xc6_33_64_ff],
  [0xcb_00_71_00, 0xcb_00_71_ff],
  [0xe0_00_00_00, 0xff_ff_ff_ff],
] as const;

const isPublicIpv4 = (address: string): boolean => {
  const octets = address.split(".").map(Number);

  if (
    octets.length !== 4 ||
    octets.some((octet) =>
      Number.isInteger(octet) ? octet < 0 || octet > 255 : true
    )
  ) {
    return false;
  }

  const numericAddress = octets.reduce(
    (value, octet) => value * 256 + octet,
    0
  );

  return !BLOCKED_IPV4_RANGES.some(
    ([start, end]) => numericAddress >= start && numericAddress <= end
  );
};

const isPublicIpv6 = (address: string): boolean => {
  const normalized = address.toLowerCase();

  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("::ffff:")
  );
};

const isPublicAddress = (address: string): boolean => {
  const family = isIP(address);

  return family === 4
    ? isPublicIpv4(address)
    : family === 6 && isPublicIpv6(address);
};

const selectPublicAddress = async (
  hostname: string
): Promise<{ address: string; family: 4 | 6 }> => {
  const addresses = await lookup(hostname, { all: true, order: "verbatim" });

  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error("BIMI host did not resolve to a public address");
  }

  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];

  if (selected === undefined) {
    throw new Error("BIMI host did not resolve to an address");
  }

  if (selected.family !== 4 && selected.family !== 6) {
    throw new Error("BIMI host resolved to an unsupported address");
  }

  return { address: selected.address, family: selected.family };
};

// LookupFunction is callback-based by definition in Node's networking API.
// oxlint-disable promise/prefer-await-to-callbacks
export const createPinnedLookup =
  (address: string, family: 4 | 6): LookupFunction =>
  (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }

    callback(null, address, family);
  };
// oxlint-enable promise/prefer-await-to-callbacks

const downloadHttps = async (url: URL, redirects = 0): Promise<Buffer> => {
  const { address, family } = await selectPublicAddress(url.hostname);

  // Node's HTTPS API is callback-based; wrapping it is required to await the
  // response while retaining a DNS-pinned lookup for SSRF protection.
  // oxlint-disable promise/avoid-new, promise/prefer-await-to-callbacks
  return new Promise<Buffer>((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        headers: {
          accept: "image/svg+xml",
          "accept-encoding": "identity",
          "user-agent": "Kisa BIMI resolver",
        },
        lookup: createPinnedLookup(address, family),
        timeout: 10_000,
      },
      (response) => {
        const { headers, statusCode } = response;
        const { location } = headers;
        const status = statusCode ?? 0;

        if (status >= 300 && status < 400 && location !== undefined) {
          response.resume();

          if (redirects >= MAX_REDIRECTS) {
            reject(new Error("Too many BIMI logo redirects"));
            return;
          }

          const redirectUrl = parseHttpsUrl(new URL(location, url).toString());

          if (redirectUrl === null) {
            reject(new Error("Invalid BIMI logo redirect"));
            return;
          }

          void (async () => {
            try {
              resolve(await downloadHttps(new URL(redirectUrl), redirects + 1));
            } catch (error) {
              reject(error);
            }
          })();
          return;
        }

        if (status !== 200) {
          response.resume();
          reject(new Error(`BIMI logo request failed (${status})`));
          return;
        }

        const contentType = headers["content-type"]
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();

        if (contentType !== "image/svg+xml") {
          response.resume();
          reject(new Error("BIMI logo is not an SVG image"));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;

        response.on("data", (chunk: Buffer) => {
          size += chunk.length;

          if (size > MAX_INDICATOR_BYTES) {
            response.destroy(new Error("BIMI logo is too large"));
            return;
          }

          chunks.push(chunk);
        });
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      }
    );

    request.on("timeout", () =>
      request.destroy(new Error("BIMI logo request timed out"))
    );
    request.on("error", reject);
  });
  // oxlint-enable promise/avoid-new, promise/prefer-await-to-callbacks
};

const validateSvgIndicator = (data: Buffer): Buffer | null => {
  if (data.length === 0 || data.length > MAX_INDICATOR_BYTES) {
    return null;
  }

  const source = data.toString("utf-8");

  if (
    /<!doctype|<!entity|<script|<foreignObject|\son\w+\s*=|javascript:|(?:href|src)\s*=\s*["'](?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/)/iu.test(
      source
    )
  ) {
    return null;
  }

  return /<svg(?:\s|>)/iu.test(source) ? data : null;
};

const toSenderBrand = (domain: string, logoData: Buffer): MailSenderBrand => ({
  domain,
  imageDataUrl: `data:image/svg+xml;base64,${logoData.toString("base64")}`,
  source: "bimi",
});

const loadCachedSenderBrand = Effect.fn("loadCachedSenderBrand")(
  function* loadCachedSenderBrand(domain: string, selector: string) {
    const row = yield* withDatabaseClient((database) =>
      database.query.mailSenderBrands.findFirst({
        where: { domain, selector },
      })
    ).pipe(
      Effect.mapError(
        () => new SenderBrandError({ message: "Could not load sender brand" })
      )
    );

    if (row === undefined || row.expiresAt <= Date.now()) {
      return null;
    }

    return {
      brand:
        row.status === "available" && row.logoData !== null
          ? toSenderBrand(domain, row.logoData)
          : null,
    } satisfies CachedSenderBrand;
  }
);

const storeSenderBrand = Effect.fn("storeSenderBrand")(
  function* storeSenderBrand(
    domain: string,
    selector: string,
    resolved: ResolvedSenderBrand | null
  ) {
    const updatedAt = Date.now();
    const values =
      resolved === null
        ? {
            authorityUrl: null,
            domain,
            expiresAt: updatedAt + MISSING_TTL_MS,
            logoData: null,
            logoUrl: null,
            selector,
            status: "missing",
            updatedAt,
          }
        : {
            authorityUrl: resolved.authorityUrl ?? null,
            domain,
            expiresAt: updatedAt + AVAILABLE_TTL_MS,
            logoData: resolved.logoData,
            logoUrl: resolved.logoUrl ?? null,
            selector,
            status: "available",
            updatedAt,
          };

    yield* withDatabaseClient((database) =>
      database
        .insert(mailSenderBrands)
        .values(values)
        .onConflictDoUpdate({
          set: values,
          target: [mailSenderBrands.domain, mailSenderBrands.selector],
        })
        .run()
    ).pipe(
      Effect.mapError(
        () => new SenderBrandError({ message: "Could not cache sender brand" })
      )
    );
  }
);

/**
 * Fetches the logo the domain itself publishes. A `BIMI-Indicator` or
 * `BIMI-Location` header in the message is never used: Gmail does not vouch
 * for it, and a sender who could pass one off as validated would have their
 * picture cached as the claimed domain's logo for every later message.
 */
const discoverSenderBrand = Effect.fn("discoverSenderBrand")(
  function* discoverSenderBrand(domain: string, target: BimiDiscoveryTarget) {
    const records = yield* Effect.tryPromise({
      catch: () =>
        new SenderBrandError({ message: "Could not resolve BIMI record" }),
      try: async () => {
        try {
          return await resolveTxt(`${target.selector}._bimi.${domain}`);
        } catch (error) {
          const code = Option.getOrUndefined(decodeDnsError(error))?.code;

          if (code === "ENODATA" || code === "ENOTFOUND") {
            return [];
          }

          throw error;
        }
      },
    });
    const bimiRecords = records
      .map((parts) => parts.join(""))
      .filter((record) => record.startsWith("v=BIMI1"));

    if (bimiRecords.length === 0) {
      return { status: "missing" } satisfies SenderBrandDiscovery;
    }

    if (bimiRecords.length > 1) {
      return { status: "invalid" } satisfies SenderBrandDiscovery;
    }

    const [bimiRecord = ""] = bimiRecords;
    const discovered = parseBimiLocation(bimiRecord);

    if (discovered === null) {
      return { status: "invalid" } satisfies SenderBrandDiscovery;
    }

    const logoData = yield* Effect.tryPromise({
      catch: () =>
        new SenderBrandError({ message: "Could not download BIMI logo" }),
      try: () => downloadHttps(new URL(discovered.logoUrl)),
    }).pipe(Effect.map(validateSvgIndicator));

    return logoData === null
      ? ({ status: "invalid" } satisfies SenderBrandDiscovery)
      : ({
          resolved: { ...discovered, logoData },
          status: "available",
        } satisfies SenderBrandDiscovery);
  }
);

export const getSenderBrand = Effect.fn("getSenderBrand")(
  function* getSenderBrand(request: SenderBrandRequest) {
    const senderDomain = extractSenderDomain(request.from);

    if (senderDomain === null) {
      return null;
    }

    const target = getBimiDiscoveryTarget(request.headers, senderDomain);

    if (target === null) {
      return null;
    }

    for (const domain of getBimiLookupDomains(target.authorDomain)) {
      const cached = yield* loadCachedSenderBrand(domain, target.selector);

      if (cached !== null) {
        if (cached.brand !== null) {
          return cached.brand;
        }

        continue;
      }

      if (!request.allowDiscovery) {
        continue;
      }

      const discovery = yield* discoverSenderBrand(domain, target).pipe(
        Effect.orElseSucceed(() => ({ status: "invalid" }) as const)
      );

      if (discovery.status === "invalid") {
        return null;
      }

      if (discovery.status === "missing") {
        yield* storeSenderBrand(domain, target.selector, null);
        continue;
      }

      yield* storeSenderBrand(domain, target.selector, discovery.resolved);

      return toSenderBrand(domain, discovery.resolved.logoData);
    }

    return null;
  }
);
