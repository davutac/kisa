import { Resolver } from "node:dns/promises";

import { Context, Effect, Layer } from "effect";
import type { Cause } from "effect";
import { constUndefined } from "effect/Function";

import type { HostedMailProvider } from "../../shared/mail-account-presets";

/** One MX record: a host that takes the domain's mail, and its preference. */
export interface MailExchange {
  readonly exchange: string;
  readonly priority: number;
}

/**
 * Reads a domain's MX records. Adding an account uses it to tell a Google
 * Workspace domain apart; tests replace it so they never reach DNS.
 */
export class MailExchangeLookup extends Context.Service<
  MailExchangeLookup,
  {
    readonly resolve: (
      domain: string
    ) => Effect.Effect<readonly MailExchange[], Cause.UnknownError>;
  }
>()("kisa/main/auth/MailExchangeLookup") {}

/** One try with a short timeout: the form waits on the answer. */
const RESOLVER_OPTIONS = { timeout: 2000, tries: 1 } as const;

export const MailExchangeLookupLive = Layer.succeed(
  MailExchangeLookup,
  MailExchangeLookup.of({
    resolve: (domain) =>
      // Any failure means the same to the form: nobody Kisa knows.
      Effect.tryPromise((signal) => {
        const resolver = new Resolver(RESOLVER_OPTIONS);
        signal.addEventListener("abort", () => resolver.cancel(), {
          once: true,
        });
        return resolver.resolveMx(domain);
      }),
  })
);

/**
 * Google's mail hosts: `smtp.google.com` today, and the older
 * `aspmx.l.google.com` family and `aspmx2.googlemail.com` and its siblings
 * that domains set up before 2023 still use.
 */
const GOOGLE_MAIL_DOMAINS = ["google.com", "googlemail.com"] as const;

/** Whether `host` is `domain` or a name under it, never a lookalike. */
const isUnder = (host: string, domain: string): boolean =>
  host === domain || host.endsWith(`.${domain}`);

/**
 * Who hosts a domain's mail, judged by its preferred MX records: those that
 * share the lowest priority, all of which must be Google's. A filtering
 * service in front of Google, or no MX at all, is nobody Kisa knows.
 */
export const toHostedMailProvider = (
  records: readonly MailExchange[]
): HostedMailProvider | undefined => {
  const lowest = Math.min(...records.map(({ priority }) => priority));
  const hosts = records
    .filter(({ priority }) => priority === lowest)
    .map(({ exchange }) => exchange.trim().toLowerCase().replace(/\.$/u, ""));
  const isGoogle =
    hosts.length > 0 &&
    hosts.every((host) =>
      GOOGLE_MAIL_DOMAINS.some((domain) => isUnder(host, domain))
    );
  return isGoogle ? "gmail" : undefined;
};

/** Longer than the resolver's own timeout, in case it does not honor it. */
const LOOKUP_TIMEOUT = "3 seconds";

/**
 * Who hosts a domain's mail, or `undefined` when Kisa does not know them or
 * cannot tell: an unreachable resolver or a slow answer is never a reason to
 * stop the user, who can still enter the servers by hand.
 */
export const findHostedMailProvider = Effect.fn("findHostedMailProvider")(
  function* findHostedMailProvider(domain: string) {
    const lookup = yield* MailExchangeLookup;
    return yield* lookup
      .resolve(domain)
      .pipe(
        Effect.timeout(LOOKUP_TIMEOUT),
        Effect.map(toHostedMailProvider),
        Effect.orElseSucceed(constUndefined)
      );
  }
);
