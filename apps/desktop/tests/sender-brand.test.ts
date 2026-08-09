// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

import {
  createPinnedLookup,
  extractSenderDomain,
  getBimiDiscoveryTarget,
  getBimiLookupDomains,
  getSenderBrand,
  parseBimiLocation,
} from "../src/main/mail/sender-brand";

vi.mock(import("../src/main/database"), () => ({
  withDatabaseClient: () => Effect.die("Unexpected database access"),
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

describe(getBimiDiscoveryTarget, () => {
  it("uses the BIMI selector exposed by Gmail for a strict DMARC sender", () => {
    expect(
      getBimiDiscoveryTarget(stripeAuthenticationHeaders, "stripe.com")
    ).toStrictEqual({
      authorDomain: "stripe.com",
      selector: "transactional",
      trustIndicator: false,
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
      trustIndicator: false,
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
      trustIndicator: false,
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
