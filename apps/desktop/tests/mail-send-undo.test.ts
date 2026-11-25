// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect vitest/prefer-import-in-mock
// Sending from a saved draft around the Undo send hold. The engine and the
// draft store are replaced at their module boundaries, so the test stays on
// what happens to the draft.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { beforeEach, vi } from "vitest";

import {
  cancelSendFromRequest,
  sendNewMessageFromRequest,
} from "../src/main/mail/engine/mail-ipc";
import { isHeldDraft } from "../src/main/mail/held-sends";
import type { MailMessageSendRequest } from "../src/shared/ipc/mail";

const state = vi.hoisted(() => ({
  drafts: new Set<string>(),
  events: [] as string[],
  sendFails: false,
  undoSendSeconds: 10,
}));

vi.mock("../src/main/settings/app-settings", () => ({
  getCurrentAppSettings: () => ({ undoSendSeconds: state.undoSendSeconds }),
}));

vi.mock("../src/main/mail/mail-drafts", async () => {
  const { Effect: MockEffect } = await import("effect");
  return {
    discardMailDraft: ({ draftId }: { readonly draftId: string }) =>
      MockEffect.sync(() => {
        state.drafts.delete(draftId);
        state.events.push(`discard ${draftId}`);
      }),
    hasDraft: (_accountId: string, draftId: string) =>
      MockEffect.sync(() => state.drafts.has(draftId)),
    republishDraft: (_accountId: string, draftId: string) =>
      MockEffect.sync(() => {
        state.events.push(`republish ${draftId}`);
      }),
  };
});

vi.mock("../src/main/mail/outgoing-attachment-authorizations", () => ({
  OutgoingAttachmentAuthorizationError: Error,
  outgoingAttachmentAuthorizations: { consume: () => Promise.resolve([]) },
}));

vi.mock("../src/main/mail/engine/mail-send", async () => {
  const { Effect: MockEffect } = await import("effect");
  // The engine's own typed error, from its module as mocked below.
  const { MailEngineError } =
    await import("../src/main/mail/engine/mail-engine");
  return {
    sendNewMessage: () =>
      MockEffect.suspend(() => {
        state.events.push("send");
        return state.sendFails
          ? MockEffect.fail(
              new MailEngineError({ message: "Server refused the message" })
            )
          : MockEffect.succeed({ refused: [] });
      }),
    sendThreadMessage: vi.fn<() => never>(),
  };
});

vi.mock("../src/main/mail/engine/mail-engine", async () => {
  const { Schema } = await import("effect");
  // oxlint-disable-next-line unicorn/throw-new-error
  class MailEngineError extends Schema.TaggedError<
    MailEngineError,
    { readonly brand: unique symbol }
  >()("MailEngineError", { message: Schema.String }) {}
  return {
    MailEngineError,
    inAccountEngine: <A>(_accountId: string, effect: A): A => effect,
  };
});

const WINDOW = 7;
const DELAY_MS = 10_000;

const request = (draftId?: string): MailMessageSendRequest => ({
  accountId: "ana@example.com",
  attachments: [],
  bcc: [],
  body: { html: "<p>Hi</p>", text: "Hi" },
  cc: [],
  draftId,
  subject: "Lunch",
  to: ["ben@example.com"],
});

/**
 * Starts sending, and waits until main holds the message. Reading the
 * attachments comes first and is a promise, and main exposes no signal for
 * the hold beginning but the held draft itself, so the test waits on that:
 * any earlier signal resumes it before the hold is registered.
 */
const startSend = (draftId: string) =>
  Effect.gen(function* start() {
    const fiber = yield* Effect.forkChild(
      sendNewMessageFromRequest(request(draftId), WINDOW)
    );
    while (!isHeldDraft("ana@example.com", draftId)) {
      yield* Effect.yieldNow;
    }
    return fiber;
  });

describe("sending from a draft with Undo send", () => {
  beforeEach(() => {
    state.drafts = new Set(["draft-1"]);
    state.events.length = 0;
    state.sendFails = false;
    state.undoSendSeconds = 10;
  });

  it.effect("deletes the draft only once the message is sent", () =>
    Effect.gen(function* sentAfterTheDelay() {
      const fiber = yield* startSend("draft-1");
      const whileHeld = [...state.events];

      yield* TestClock.adjust(DELAY_MS);

      expect({
        result: yield* Fiber.join(fiber),
        whileHeld,
        events: state.events,
      }).toStrictEqual({
        events: ["send", "discard draft-1"],
        result: { kind: "sent", refusedRecipients: [] },
        whileHeld: [],
      });
    })
  );

  it.effect("puts the draft back and sends nothing when undone", () =>
    Effect.gen(function* undone() {
      const fiber = yield* startSend("draft-1");

      const undo = yield* cancelSendFromRequest(
        { accountId: "ana@example.com", draftId: "draft-1" },
        WINDOW
      );
      const result = yield* Fiber.join(fiber);
      yield* TestClock.adjust(DELAY_MS);

      expect({ events: state.events, result, undo }).toStrictEqual({
        events: ["republish draft-1"],
        result: { kind: "canceled" },
        undo: "canceled",
      });
    })
  );

  it.effect(
    "keeps the draft and passes the server's reason on when sending fails",
    () =>
      Effect.gen(function* failed() {
        state.sendFails = true;
        const fiber = yield* startSend("draft-1");

        yield* TestClock.adjust(DELAY_MS);
        const error = yield* Effect.flip(Fiber.join(fiber));

        expect({
          drafts: [...state.drafts],
          error: error.message,
          events: state.events,
        }).toStrictEqual({
          drafts: ["draft-1"],
          error: "Server refused the message",
          events: ["send", "republish draft-1"],
        });
      })
  );

  it.effect(
    "sends a message whose draft a newer reply replaced, rather than lose it",
    () =>
      Effect.gen(function* replaced() {
        const fiber = yield* startSend("draft-1");
        state.drafts.delete("draft-1");

        const undo = yield* cancelSendFromRequest(
          { accountId: "ana@example.com", draftId: "draft-1" },
          WINDOW
        );
        yield* TestClock.adjust(DELAY_MS);

        expect({ result: yield* Fiber.join(fiber), undo }).toStrictEqual({
          result: { kind: "sent", refusedRecipients: [] },
          undo: "too-late",
        });
      })
  );

  it.effect(
    "sends at once when Undo send is off, and still removes the draft",
    () =>
      Effect.gen(function* off() {
        state.undoSendSeconds = 0;

        const result = yield* sendNewMessageFromRequest(
          request("draft-1"),
          WINDOW
        );

        expect({ events: state.events, result }).toStrictEqual({
          events: ["send", "discard draft-1"],
          result: { kind: "sent", refusedRecipients: [] },
        });
      })
  );

  it.effect("holds nothing for a message that comes from no draft", () =>
    Effect.gen(function* withoutDraft() {
      const result = yield* sendNewMessageFromRequest(request(), WINDOW);

      expect({ events: state.events, result }).toStrictEqual({
        events: ["send"],
        result: { kind: "sent", refusedRecipients: [] },
      });
    })
  );
});
