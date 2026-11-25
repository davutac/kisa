// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { ImapFlow } from "imapflow";

import {
  LOGOUT_TIMEOUT_MS,
  closeClient,
} from "../src/main/mail/engine/imap-session";

/** An imapflow client whose LOGOUT answers when `logout` says so. */
const client = (logout: () => Promise<void>, usable = true) => {
  const calls: string[] = [];

  return {
    calls,
    client: {
      close: () => {
        calls.push("close");
      },
      logout: async () => {
        calls.push("logout");
        await logout();
        calls.push("logged out");
      },
      usable,
    } satisfies Pick<ImapFlow, "close" | "logout" | "usable">,
  };
};

describe("closing an IMAP connection", () => {
  it.effect("says goodbye, then closes the socket", () =>
    Effect.gen(function* answeringServer() {
      const { calls, client: answering } = client(() => Promise.resolve());

      yield* closeClient(answering);

      expect(calls).toStrictEqual(["logout", "logged out", "close"]);
    })
  );

  it.effect("stops waiting for a server that never answers LOGOUT", () =>
    Effect.gen(function* silentServer() {
      // The server never answers.
      const { calls, client: silent } = client(
        () => Promise.withResolvers<undefined>().promise
      );

      // Releases run uninterruptibly, as a session scope's close does.
      const closing = yield* Effect.forkChild(
        Effect.uninterruptible(closeClient(silent))
      );

      yield* TestClock.adjust(LOGOUT_TIMEOUT_MS);
      yield* Fiber.join(closing);

      expect(calls).toStrictEqual(["logout", "close"]);
    })
  );

  it.effect("closes a connection that can no longer log out", () =>
    Effect.gen(function* unusableConnection() {
      const { calls, client: unusable } = client(
        () => Promise.resolve(),
        false
      );

      yield* closeClient(unusable);

      expect(calls).toStrictEqual(["close"]);
    })
  );
});
