// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { afterEach, beforeEach, vi } from "vitest";

import {
  extractSenderDomain,
  isAuthenticatedSender,
} from "../src/main/mail/sender-authentication";
import {
  createPinnedLookup,
  getBimiDiscoveryTarget,
  getBimiLookupDomains,
  getSenderBrand,
  parseBimiLocation,
} from "../src/main/mail/sender-brand";

const testState = vi.hoisted(() => ({
  databaseAvailable: false,
  txtLookups: [] as string[],
}));

// An empty sender-brand cache. Database access stays an error unless a test
// opts in, so header checks are proven to fail before the cache is read.
vi.mock(import("../src/main/database"), () => ({
  withDatabaseClient: <A>(run: (database: never) => Promise<A>) =>
    testState.databaseAvailable
      ? Effect.promise(() =>
          run({
            insert: () => ({
              values: () => ({
                onConflictDoUpdate: () => ({ run: () => Promise.resolve() }),
              }),
            }),
            query: {
              gmailSenderBrands: {
                findFirst: () => Promise.resolve(),
                findMany: () => Promise.resolve([]),
              },
            },
          } as never)
        )
      : Effect.die("Unexpected database access"),
}));

vi.mock(import("node:dns/promises"), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveTxt: vi.fn<(name: string) => Promise<string[][]>>((name) => {
    testState.txtLookups.push(name);
    return Promise.resolve([]);
  }),
}));

const stripeAuthenticationHeaders = [
  {
    name: "Authentication-Results",
    value:
      "mx.google.com; dkim=pass header.i=@stripe.com header.s=stripe-selector; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=stripe.com",
  },
  { name: "BIMI-Selector", value: "v=BIMI1; s=transactional;" },
] as const;

describe(extractSenderDomain, () => {
  it("extracts and normalizes the domain from a named mailbox", () => {
    expect(extractSenderDomain("Stripe <notifications@Stripe.COM>")).toBe(
      "stripe.com"
    );
  });

  it("prefers the angle-bracket mailbox over an address-like display name", () => {
    expect(extractSenderDomain('"service@paypal.de" <service@paypal.de>')).toBe(
      "paypal.de"
    );
  });

  it("rejects addresses without a public-looking domain", () => {
    expect(extractSenderDomain("sender@localhost")).toBeNull();
    expect(extractSenderDomain("sender@127.0.0.1")).toBeNull();
  });
});

describe(parseBimiLocation, () => {
  it("parses HTTPS logo and authority locations", () => {
    expect(
      parseBimiLocation(
        "v=BIMI1; l=https://cdn.example.com/brand.svg; a=https://authority.example/vmc.pem"
      )
    ).toStrictEqual({
      authorityUrl: "https://authority.example/vmc.pem",
      logoUrl: "https://cdn.example.com/brand.svg",
    });
  });

  it("accepts a record without an authority", () => {
    expect(
      parseBimiLocation("v=BIMI1; l=https://cdn.example.com/brand.svg; a=")
    ).toStrictEqual({ logoUrl: "https://cdn.example.com/brand.svg" });
  });

  it("rejects insecure or malformed records", () => {
    expect(
      parseBimiLocation("v=BIMI1; l=http://cdn.example.com/brand.svg")
    ).toBeNull();
    expect(
      parseBimiLocation(
        "v=BIMI1; l=https://user:password@cdn.example.com/brand.svg"
      )
    ).toBeNull();
    expect(
      parseBimiLocation("v=BIMI2; l=https://cdn.example.com/brand.svg")
    ).toBeNull();
  });
});

describe(isAuthenticatedSender, () => {
  it("accepts an aligned DMARC pass in Gmail's own header", () => {
    expect(
      isAuthenticatedSender(
        "Stripe <notifications@stripe.com>",
        stripeAuthenticationHeaders
      )
    ).toBeTruthy();
  });

  it("rejects a sender whose domain Gmail did not authenticate", () => {
    expect(
      isAuthenticatedSender(
        "Stripe <notifications@stripe.example>",
        stripeAuthenticationHeaders
      )
    ).toBeFalsy();
    expect(isAuthenticatedSender("notifications@stripe.com", [])).toBeFalsy();
  });

  // Gmail adds its header above the ones a message arrives with, so a
  // lookalike further down was written by the sender.
  it("reads only the topmost Authentication-Results header", () => {
    const forgedBelow = {
      name: "Authentication-Results",
      value: "mx.google.com; dmarc=pass (p=REJECT) header.from=stripe.com",
    };

    expect(
      isAuthenticatedSender("notifications@stripe.com", [
        {
          name: "Authentication-Results",
          value: "mx.google.com; dmarc=fail (p=NONE) header.from=stripe.com",
        },
        forgedBelow,
      ])
    ).toBeFalsy();
    expect(
      isAuthenticatedSender("notifications@stripe.com", [
        { name: "Authentication-Results", value: "mx.other.example; none" },
        forgedBelow,
      ])
    ).toBeFalsy();
  });
});

describe(getBimiDiscoveryTarget, () => {
  it("uses the BIMI selector exposed by Gmail for a strict DMARC sender", () => {
    expect(
      getBimiDiscoveryTarget(stripeAuthenticationHeaders, "stripe.com")
    ).toStrictEqual({
      authorDomain: "stripe.com",
      selector: "transactional",
    });
  });

  it("keeps the RFC5322.From domain as the author domain", () => {
    expect(
      getBimiDiscoveryTarget(
        [
          {
            name: "Authentication-Results",
            value:
              "mx.google.com; dkim=pass header.i=@em1.cloudflare.com header.s=scph0124; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=cloudflare.com",
          },
        ],
        "em1.cloudflare.com"
      )
    ).toStrictEqual({
      authorDomain: "em1.cloudflare.com",
      selector: "default",
    });
  });

  it("rejects sender-controlled authentication results", () => {
    expect(
      getBimiDiscoveryTarget(
        [
          {
            name: "Authentication-Results",
            value:
              "attacker.example; dmarc=pass (p=REJECT) header.from=stripe.com",
          },
          { name: "BIMI-Selector", value: "v=BIMI1; s=transactional;" },
        ],
        "stripe.com"
      )
    ).toBeNull();
  });

  it("requires a strict DMARC policy when Gmail has not validated BIMI", () => {
    expect(
      getBimiDiscoveryTarget(
        [
          {
            name: "Authentication-Results",
            value:
              "mx.google.com; dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=stripe.com",
          },
          { name: "BIMI-Selector", value: "v=BIMI1; s=transactional;" },
        ],
        "stripe.com"
      )
    ).toBeNull();
  });

  it("accepts a full-coverage quarantine DMARC policy", () => {
    expect(
      getBimiDiscoveryTarget(
        [
          {
            name: "Authentication-Results",
            value:
              "mx.google.com; dmarc=pass (p=QUARANTINE sp=QUARANTINE dis=NONE) header.from=amazon.de",
          },
        ],
        "amazon.de"
      )
    ).toStrictEqual({
      authorDomain: "amazon.de",
      selector: "default",
    });
  });

  it("rejects a partial quarantine DMARC policy", () => {
    expect(
      getBimiDiscoveryTarget(
        [
          {
            name: "Authentication-Results",
            value:
              "mx.google.com; dmarc=pass (p=QUARANTINE pct=50 dis=NONE) header.from=amazon.de",
          },
        ],
        "amazon.de"
      )
    ).toBeNull();
  });
});

describe(getBimiLookupDomains, () => {
  it("queries the author domain before its organizational domain", () => {
    expect(getBimiLookupDomains("em1.cloudflare.com")).toStrictEqual([
      "em1.cloudflare.com",
      "cloudflare.com",
    ]);
  });

  it("uses the Public Suffix List to find multi-label suffixes", () => {
    expect(getBimiLookupDomains("mail.example.co.uk")).toStrictEqual([
      "mail.example.co.uk",
      "example.co.uk",
    ]);
  });

  it("does not query the same domain twice", () => {
    expect(getBimiLookupDomains("paypal.de")).toStrictEqual(["paypal.de"]);
  });
});

describe(createPinnedLookup, () => {
  it("returns an address array when Node requests all addresses", () => {
    let resolvedAddresses: unknown;

    createPinnedLookup("52.219.194.106", 4)(
      "stripe-images.s3.us-west-1.amazonaws.com",
      { all: true },
      (_error, addresses) => {
        resolvedAddresses = addresses;
      }
    );

    expect(resolvedAddresses).toStrictEqual([
      { address: "52.219.194.106", family: 4 },
    ]);
  });
});

describe(getSenderBrand, () => {
  it.effect("ignores BIMI headers not validated by Gmail", () =>
    Effect.gen(function* ignoresUntrustedHeaders() {
      const brand = yield* getSenderBrand({
        allowDiscovery: true,
        from: "Stripe <notifications@stripe.com>",
        headers: [
          {
            name: "Authentication-Results",
            value:
              "attacker.example; dmarc=pass header.from=stripe.com; bimi=pass header.d=stripe.com",
          },
          { name: "BIMI-Indicator", value: "PHN2Zz48L3N2Zz4=" },
        ],
      });

      expect(brand).toBeNull();
    })
  );

  it.effect("requires Gmail to report a successful BIMI check", () =>
    Effect.gen(function* requiresBimiPass() {
      const brand = yield* getSenderBrand({
        allowDiscovery: true,
        from: "Stripe <notifications@stripe.com>",
        headers: [
          {
            name: "Authentication-Results",
            value: "mx.google.com; dmarc=pass header.from=stripe.com",
          },
        ],
      });

      expect(brand).toBeNull();
    })
  );
});

describe("sender brand discovery consent", () => {
  beforeEach(() => {
    testState.databaseAvailable = true;
    testState.txtLookups.length = 0;
  });

  afterEach(() => {
    testState.databaseAvailable = false;
  });

  it.effect("does not query the sender's DNS without consent", () =>
    Effect.gen(function* withoutConsent() {
      const brand = yield* getSenderBrand({
        allowDiscovery: false,
        from: "Stripe <notifications@stripe.com>",
        headers: stripeAuthenticationHeaders,
      });

      expect(brand).toBeNull();
      expect(testState.txtLookups).toStrictEqual([]);
    })
  );

  it.effect("queries the sender's BIMI record once the reader allows it", () =>
    Effect.gen(function* withConsent() {
      const brand = yield* getSenderBrand({
        allowDiscovery: true,
        from: "Stripe <notifications@stripe.com>",
        headers: stripeAuthenticationHeaders,
      });

      expect(brand).toBeNull();
      expect(testState.txtLookups).toStrictEqual([
        "transactional._bimi.stripe.com",
      ]);
    })
  );

  it.effect("fetches the domain's own logo instead of one in the message", () =>
    Effect.gen(function* ignoresMessageLogo() {
      const brand = yield* getSenderBrand({
        allowDiscovery: true,
        from: "Stripe <notifications@stripe.com>",
        headers: [
          {
            name: "Authentication-Results",
            value:
              "mx.google.com; dmarc=pass (p=REJECT) header.from=stripe.com; bimi=pass header.d=stripe.com header.selector=brand",
          },
          {
            name: "BIMI-Indicator",
            value: Buffer.from("<svg></svg>").toString("base64"),
          },
        ],
      });

      expect(brand).toBeNull();
      expect(testState.txtLookups).toStrictEqual(["brand._bimi.stripe.com"]);
    })
  );
});
