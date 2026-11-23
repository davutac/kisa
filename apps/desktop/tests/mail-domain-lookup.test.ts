// Who hosts a custom domain's mail, as the Add account window asks main. DNS
// is replaced here: the classification and the fallbacks are what matter.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";

import {
  findHostedMailProvider,
  MailExchangeLookup,
  toHostedMailProvider,
} from "../src/main/auth/mail-domain-lookup";
import type { MailExchange } from "../src/main/auth/mail-domain-lookup";

const lookupAnswering = (
  answer: Effect.Effect<readonly MailExchange[], Cause.UnknownError>
) =>
  Layer.succeed(
    MailExchangeLookup,
    MailExchangeLookup.of({ resolve: () => answer })
  );

describe(toHostedMailProvider, () => {
  it.each([
    [[{ exchange: "smtp.google.com", priority: 1 }]],
    [[{ exchange: "SMTP.GOOGLE.COM.", priority: 1 }]],
    [
      [
        { exchange: "alt1.aspmx.l.google.com", priority: 5 },
        { exchange: "aspmx.l.google.com", priority: 1 },
        { exchange: "aspmx2.googlemail.com", priority: 10 },
      ],
    ],
  ])("knows Google's mail hosts, current and older: %j", (records) => {
    expect(toHostedMailProvider(records)).toBe("gmail");
  });

  it("judges by the preferred records alone", () => {
    expect(
      toHostedMailProvider([
        { exchange: "mx.filter.example", priority: 1 },
        { exchange: "aspmx.l.google.com", priority: 5 },
      ])
    ).toBeUndefined();
    expect(
      toHostedMailProvider([
        { exchange: "aspmx.l.google.com", priority: 1 },
        { exchange: "mx.other.example", priority: 1 },
      ])
    ).toBeUndefined();
  });

  it("takes no lookalike, no other host and no MX at all for Google", () => {
    for (const exchange of [
      "smtp.google.com.example",
      "notgoogle.com",
      "google.com-mail.example",
      "mx01.mail.icloud.com",
      // A null MX: the domain takes no mail.
      "",
    ]) {
      expect(toHostedMailProvider([{ exchange, priority: 0 }])).toBeUndefined();
    }
    expect(toHostedMailProvider([])).toBeUndefined();
  });
});

describe(findHostedMailProvider, () => {
  it.effect("answers Google for a Google Workspace domain", () =>
    Effect.gen(function* googleDomain() {
      const provider = yield* findHostedMailProvider("example.org").pipe(
        Effect.provide(
          lookupAnswering(
            Effect.succeed([{ exchange: "smtp.google.com", priority: 1 }])
          )
        )
      );

      expect(provider).toBe("gmail");
    })
  );

  it.effect("answers nobody when the lookup fails", () =>
    Effect.gen(function* failedLookup() {
      const provider = yield* findHostedMailProvider("example.org").pipe(
        Effect.provide(
          lookupAnswering(Effect.fail(new Cause.UnknownError("ENOTFOUND")))
        )
      );

      expect(provider).toBeUndefined();
    })
  );

  it.effect("answers nobody, and stops asking, when DNS does not answer", () =>
    Effect.gen(function* slowResolver() {
      let wasInterrupted = false;
      const never = Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            wasInterrupted = true;
          })
        )
      );
      const lookup = yield* Effect.forkChild(
        findHostedMailProvider("example.org").pipe(
          Effect.provide(lookupAnswering(never))
        )
      );
      yield* TestClock.adjust("3 seconds");

      expect(yield* Fiber.join(lookup)).toBeUndefined();
      expect(wasInterrupted).toBeTruthy();
    })
  );
});
