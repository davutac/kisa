// A wait in IDLE against a stand-in for imapflow's client: what ends it, and
// what state it leaves the connection in.
// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { AccountId } from "@repo/mail/ids";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  IDLE_END_TIMEOUT_MS,
  watchMailbox,
} from "../src/main/mail/engine/imap-session";
import type { IdleClient } from "../src/main/mail/engine/imap-session";

const MAX_MS = 300_000;
const accountId = AccountId.make("test@example.com");

type MailboxListener = Parameters<IdleClient["on"]>[1];

/** Lets a test wait for the next time something happens. */
const createCue = () => {
  const waiters: (() => void)[] = [];
  return {
    fire: (): void => {
      for (const waiter of waiters.splice(0)) {
        waiter();
      }
    },
    next: (): Promise<null> => {
      const cue = Promise.withResolvers<null>();
      waiters.push(() => cue.resolve(null));
      return cue.promise;
    },
  };
};

/**
 * A client whose IDLE runs until a command ends it, as imapflow's does. The
 * test ends an IDLE itself to play imapflow's keepalive or a server refusal.
 */
const createClient = (behavior: { readonly answersNoop?: boolean } = {}) => {
  const listeners = new Map<string, Set<MailboxListener>>();
  const listenersFor = (event: string): Set<MailboxListener> => {
    const existing = listeners.get(event) ?? new Set<MailboxListener>();
    listeners.set(event, existing);
    return existing;
  };
  const emit = (event: string, data: Parameters<MailboxListener>[0]): void => {
    for (const listener of listenersFor(event)) {
      listener(data);
    }
  };
  const calls: string[] = [];
  const state = { usable: true };
  const idleStarted = createCue();
  const noopSent = createCue();
  let idle: PromiseWithResolvers<boolean | undefined> | undefined;

  const client: IdleClient = {
    getMailboxLock: (path, options) => {
      calls.push(`lock ${path} ${options.readOnly ? "read" : "write"}`);
      return Promise.resolve({
        release: () => {
          calls.push("release");
        },
      });
    },
    idle: () => {
      calls.push("idle");
      idle = Promise.withResolvers();
      idleStarted.fire();
      return idle.promise;
    },
    noop: () => {
      calls.push("noop");
      noopSent.fire();
      if (behavior.answersNoop === false) {
        return Promise.withResolvers<undefined>().promise;
      }
      idle?.resolve(undefined);
      return Promise.resolve();
    },
    off: (event, listener) => listenersFor(event).delete(listener),
    on: (event, listener) => listenersFor(event).add(listener),
    get usable() {
      return state.usable;
    },
  };

  return {
    calls,
    client,
    /** Ends the running IDLE without a command from the wait. */
    endIdle: (ran?: boolean): void => {
      idle?.resolve(ran);
    },
    /** The server reports the Inbox's message count going from one to another. */
    exists: (prevCount: number, count: number): void => {
      emit("exists", { count, path: "INBOX", prevCount });
    },
    listeners: () =>
      [...listeners.values()].reduce((total, set) => total + set.size, 0),
    nextIdle: idleStarted.next,
    nextNoop: noopSent.next,
    /** The server reports a message gone, or a flag set or cleared. */
    report: (event: "expunge" | "flags"): void => {
      emit(event, { path: "INBOX" });
    },
    state,
  };
};

type Server = ReturnType<typeof createClient>;

const watch = (server: Server, stop: Deferred.Deferred<void>) =>
  watchMailbox(accountId, server.client, "INBOX", { maxMs: MAX_MS, stop });

/** Starts a wait and returns once it is idling. */
const startWatch = Effect.fnUntraced(function* startWatch(server: Server) {
  const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();
  const idling = server.nextIdle();
  const fiber = yield* Effect.forkChild(watch(server, stop));
  yield* Effect.promise(() => idling);
  return { fiber, stop };
});

/** The same, for a wait expected to fail: the fiber ends with the failure. */
const startFailingWatch = Effect.fnUntraced(function* startFailingWatch(
  server: Server
) {
  const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();
  const idling = server.nextIdle();
  const fiber = yield* Effect.forkChild(Effect.flip(watch(server, stop)));
  yield* Effect.promise(() => idling);
  return { fiber, stop };
});

const CHANGES = [
  ["a message gone", (server: Server) => server.report("expunge")],
  ["a flag set or cleared", (server: Server) => server.report("flags")],
  ["the count falling", (server: Server) => server.exists(2, 1)],
] as const;

describe(watchMailbox, () => {
  it.effect(
    "ends when mail arrives, with the IDLE ended and the mailbox released",
    () =>
      Effect.gen(function* arrival() {
        const server = createClient();
        const { fiber } = yield* startWatch(server);

        server.exists(1, 2);

        expect(yield* Fiber.join(fiber)).toBe("arrived");
        expect(server.calls).toStrictEqual([
          "lock INBOX read",
          "idle",
          "noop",
          "release",
        ]);
        expect(server.listeners()).toBe(0);
      })
  );

  for (const [name, report] of CHANGES) {
    it.effect(`ends as a change on ${name}`, () =>
      Effect.gen(function* change() {
        const server = createClient();
        const { fiber } = yield* startWatch(server);

        report(server);

        expect(yield* Fiber.join(fiber)).toBe("changed");
        expect(server.calls.at(-2)).toBe("noop");
        expect(server.listeners()).toBe(0);
      })
    );
  }

  it.effect("ends quietly when its time is up", () =>
    Effect.gen(function* timeUp() {
      const server = createClient();
      const { fiber } = yield* startWatch(server);

      yield* TestClock.adjust(MAX_MS);

      expect(yield* Fiber.join(fiber)).toBe("quiet");
      expect(server.calls.at(-2)).toBe("noop");
    })
  );

  it.effect(
    "ends quietly when asked to stop, leaving the connection free",
    () =>
      Effect.gen(function* stopped() {
        const server = createClient();
        const { fiber, stop } = yield* startWatch(server);

        yield* Deferred.succeed(stop, undefined);

        expect(yield* Fiber.join(fiber)).toBe("quiet");
        expect(server.calls).toStrictEqual([
          "lock INBOX read",
          "idle",
          "noop",
          "release",
        ]);
      })
  );

  it.effect("sends the server nothing when it is asked to stop first", () =>
    Effect.gen(function* stoppedFirst() {
      const server = createClient();
      const stop: Deferred.Deferred<void> = Deferred.makeUnsafe();
      yield* Deferred.succeed(stop, undefined);

      expect(yield* watch(server, stop)).toBe("quiet");
      expect(server.calls).toStrictEqual([]);
    })
  );

  // imapflow ends a quiet IDLE with a NOOP of its own, as a keepalive.
  it.effect("starts the IDLE again when something else ended it", () =>
    Effect.gen(function* keptAlive() {
      const server = createClient();
      const { fiber } = yield* startWatch(server);

      const idlingAgain = server.nextIdle();
      server.endIdle();
      yield* Effect.promise(() => idlingAgain);
      server.exists(1, 2);

      expect(yield* Fiber.join(fiber)).toBe("arrived");
      expect(server.calls).toStrictEqual([
        "lock INBOX read",
        "idle",
        "idle",
        "noop",
        "release",
      ]);
    })
  );

  it.effect(
    "keeps waiting on its clock when the server will not run IDLE",
    () =>
      Effect.gen(function* refused() {
        const server = createClient();
        const { fiber } = yield* startWatch(server);

        server.endIdle(false);
        yield* TestClock.adjust(MAX_MS);

        expect(yield* Fiber.join(fiber)).toBe("quiet");
        expect(server.calls).toStrictEqual([
          "lock INBOX read",
          "idle",
          "noop",
          "release",
        ]);
      })
  );

  it.effect(
    "fails as a lost connection when the IDLE ends with the connection gone",
    () =>
      Effect.gen(function* lost() {
        const server = createClient();
        const { fiber } = yield* startFailingWatch(server);

        server.state.usable = false;
        server.endIdle();

        expect(yield* Fiber.join(fiber)).toMatchObject({
          _tag: "MailConnectionError",
        });
        expect(server.calls.at(-1)).toBe("release");
        expect(server.listeners()).toBe(0);
      })
  );

  // A connection that died while the computer slept answers nothing.
  it.effect("gives up on a server that does not end the IDLE", () =>
    Effect.gen(function* silent() {
      const server = createClient({ answersNoop: false });
      const { fiber, stop } = yield* startFailingWatch(server);

      const ending = server.nextNoop();
      yield* Deferred.succeed(stop, undefined);
      yield* Effect.promise(() => ending);
      yield* TestClock.adjust(IDLE_END_TIMEOUT_MS);

      expect(yield* Fiber.join(fiber)).toMatchObject({
        _tag: "MailConnectionError",
      });
      expect(server.calls.at(-1)).toBe("release");
    })
  );

  // Quit and disconnect close the connection next; they must not wait on a
  // server that may be gone.
  it.effect(
    "interrupted, releases the mailbox without a word to the server",
    () =>
      Effect.gen(function* abandoned() {
        const server = createClient();
        const { fiber } = yield* startWatch(server);

        yield* Fiber.interrupt(fiber);

        expect(server.calls).toStrictEqual([
          "lock INBOX read",
          "idle",
          "release",
        ]);
        expect(server.listeners()).toBe(0);
      })
  );

  it.effect("interrupted, stops waiting for the IDLE to end", () =>
    Effect.gen(function* abandonedWhileEnding() {
      const server = createClient({ answersNoop: false });
      const { fiber, stop } = yield* startWatch(server);

      const ending = server.nextNoop();
      yield* Deferred.succeed(stop, undefined);
      yield* Effect.promise(() => ending);
      yield* Fiber.interrupt(fiber);

      expect(server.calls.at(-1)).toBe("release");
    })
  );
});
