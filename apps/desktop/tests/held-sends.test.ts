// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import {
  cancelHeldSend,
  holdSend,
  isHeldDraft,
  releaseHeldSends,
} from "../src/main/mail/held-sends";

const DELAY_MS = 10_000;
const WINDOW = 1;
const accountId = "ana@example.com";

/** Starts holding a message, and lets the hold begin. */
const hold = (draftId: string, send: Effect.Effect<string>) =>
  Effect.gen(function* startHold() {
    const fiber = yield* Effect.forkChild(
      holdSend({ accountId, draftId }, WINDOW, DELAY_MS, send)
    );

    yield* Effect.yieldNow;

    return fiber;
  });

/** A send that counts itself. */
const counted = () => {
  let sends = 0;

  return {
    send: Effect.sync(() => {
      sends += 1;

      return "sent";
    }),
    sends: () => sends,
  };
};

describe("messages held for Undo send", () => {
  it.effect("go out once the delay runs out, and only then", () =>
    Effect.gen(function* waitsOutTheDelay() {
      const { send, sends } = counted();
      const fiber = yield* hold("waits", send);

      yield* TestClock.adjust(DELAY_MS - 1);
      const early = { held: isHeldDraft(accountId, "waits"), sends: sends() };
      yield* TestClock.adjust(1);
      const result = yield* Fiber.join(fiber);

      expect({
        early,
        held: isHeldDraft(accountId, "waits"),
        result,
      }).toStrictEqual({
        early: { held: true, sends: 0 },
        held: false,
        result: { kind: "sent", value: "sent" },
      });
    })
  );

  it.effect("send nothing when Undo comes in time", () =>
    Effect.gen(function* undoneInTime() {
      const { send, sends } = counted();
      const fiber = yield* hold("undone", send);

      const canceled = yield* cancelHeldSend(
        { accountId, draftId: "undone" },
        WINDOW
      );

      const result = yield* Fiber.join(fiber);
      yield* TestClock.adjust(DELAY_MS);

      expect({
        canceled,
        held: isHeldDraft(accountId, "undone"),
        result,
        sends: sends(),
      }).toStrictEqual({
        canceled: "canceled",
        held: false,
        result: { kind: "canceled" },
        sends: 0,
      });
    })
  );

  it.effect("are too late to undo once they are on their way", () =>
    Effect.gen(function* undoneTooLate() {
      const reached = yield* Deferred.make<true>();
      const finish = yield* Deferred.make<true>();

      const fiber = yield* hold(
        "too-late",
        Deferred.succeed(reached, true).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.as("sent")
        )
      );

      yield* TestClock.adjust(DELAY_MS);
      yield* Deferred.await(reached);

      const whileSending = yield* cancelHeldSend(
        { accountId, draftId: "too-late" },
        WINDOW
      );

      yield* Deferred.succeed(finish, true);
      const result = yield* Fiber.join(fiber);

      const afterwards = yield* cancelHeldSend(
        { accountId, draftId: "too-late" },
        WINDOW
      );

      expect({ afterwards, result, whileSending }).toStrictEqual({
        afterwards: "too-late",
        result: { kind: "sent", value: "sent" },
        whileSending: "too-late",
      });
    })
  );

  it.effect("can be undone only from the window that sent them", () =>
    Effect.gen(function* otherWindow() {
      const { send } = counted();
      const fiber = yield* hold("other-window", send);

      const error = yield* Effect.flip(
        cancelHeldSend({ accountId, draftId: "other-window" }, WINDOW + 1)
      );

      yield* TestClock.adjust(DELAY_MS);

      expect({
        error: error._tag,
        result: yield* Fiber.join(fiber),
      }).toStrictEqual({
        error: "HeldSendError",
        result: { kind: "sent", value: "sent" },
      });
    })
  );

  it.effect("refuse the same draft a second time while it is held", () =>
    Effect.gen(function* doublePress() {
      const { send, sends } = counted();
      const fiber = yield* hold("twice", send);

      const error = yield* Effect.flip(
        holdSend({ accountId, draftId: "twice" }, WINDOW, DELAY_MS, send)
      );

      yield* TestClock.adjust(DELAY_MS);
      yield* Fiber.join(fiber);

      expect({ error: error._tag, sends: sends() }).toStrictEqual({
        error: "HeldSendError",
        sends: 1,
      });
    })
  );

  it.effect("go out at once when Kisa quits, and quitting waits for them", () =>
    Effect.gen(function* quitting() {
      const first = counted();
      const second = counted();

      const fibers = [
        yield* hold("quit-1", first.send),
        yield* hold("quit-2", second.send),
      ];

      yield* releaseHeldSends();

      expect({
        held: [
          isHeldDraft(accountId, "quit-1"),
          isHeldDraft(accountId, "quit-2"),
        ],
        results: yield* Fiber.joinAll(fibers),
        sends: [first.sends(), second.sends()],
      }).toStrictEqual({
        held: [false, false],
        results: [
          { kind: "sent", value: "sent" },
          { kind: "sent", value: "sent" },
        ],
        sends: [1, 1],
      });
    })
  );

  it.effect("finish what follows a send before a quit lets go", () =>
    Effect.gen(function* quitWaitsForCleanup() {
      const cleaned = yield* Deferred.make<true>();

      const fiber = yield* Effect.forkChild(
        holdSend(
          { accountId, draftId: "cleanup" },
          WINDOW,
          DELAY_MS,
          Effect.succeed("sent"),
          () => Deferred.await(cleaned).pipe(Effect.asVoid)
        )
      );

      yield* Effect.yieldNow;

      const quit = yield* Deferred.make<true>();

      const quitting = yield* Effect.forkChild(
        releaseHeldSends().pipe(Effect.andThen(Deferred.succeed(quit, true)))
      );

      yield* Effect.yieldNow;
      const quitBeforeCleanup = yield* Deferred.isDone(quit);
      yield* Deferred.succeed(cleaned, true);
      yield* Fiber.join(quitting);

      expect({
        quitBeforeCleanup,
        result: yield* Fiber.join(fiber),
      }).toStrictEqual({
        quitBeforeCleanup: false,
        result: { kind: "sent", value: "sent" },
      });
    })
  );

  it.effect("end without sending when their account is disconnected", () =>
    Effect.gen(function* disconnected() {
      const { send, sends } = counted();
      const fiber = yield* hold("disconnected", send);

      yield* Fiber.interrupt(fiber);

      const undo = yield* cancelHeldSend(
        { accountId, draftId: "disconnected" },
        WINDOW
      );

      yield* TestClock.adjust(DELAY_MS);

      expect({
        held: isHeldDraft(accountId, "disconnected"),
        sends: sends(),
        undo,
      }).toStrictEqual({ held: false, sends: 0, undo: "too-late" });
    })
  );
});
