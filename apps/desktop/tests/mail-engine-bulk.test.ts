// The engine is replaced at its module boundary so the test stays on how a
// selection is split into accounts and rounds.
// oxlint-disable vitest/prefer-import-in-mock
import type { ThreadAction } from "@repo/mail/mutations";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { bulkMutateThreads } from "../src/main/mail/engine/mail-ipc";

const state = vi.hoisted(() => ({
  calls: [] as {
    accountId: string;
    action: ThreadAction;
    threadIds: string[];
  }[],
  failingAccounts: new Set<string>(),
}));

vi.mock("../src/main/mail/engine/mail-send", () => ({
  sendNewMessage: vi.fn<() => never>(),
  sendThreadMessage: vi.fn<() => never>(),
}));

vi.mock("../src/main/mail/engine/mail-engine", async () => {
  const { Effect: MockEffect, Schema } = await import("effect");
  // oxlint-disable-next-line unicorn/throw-new-error
  class MailEngineError extends Schema.TaggedError<MailEngineError>()(
    "MailEngineError",
    { message: Schema.String }
  ) {}

  return {
    MailEngineError,
    applyThreadActions: (
      accountId: string,
      threadIds: readonly string[],
      action: ThreadAction
    ) =>
      MockEffect.suspend(() => {
        state.calls.push({ accountId, action, threadIds: [...threadIds] });
        return state.failingAccounts.has(accountId)
          ? MockEffect.fail(new MailEngineError({ message: "offline" }))
          : MockEffect.void;
      }),
    inAccountEngine: <A>(_accountId: string, effect: A): A => effect,
  };
});

const threads = (accountId: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({
    accountId,
    threadId: `${accountId}-${index}`,
  }));

describe("bulk thread actions", () => {
  beforeEach(() => {
    state.calls.length = 0;
    state.failingAccounts.clear();
  });

  it("changes each account in rounds and reports the ones that failed", async () => {
    state.failingAccounts.add("b@example.com");
    const selection = [
      ...threads("a@example.com", 300),
      ...threads("b@example.com", 2),
      // Selected twice, changed once.
      { accountId: "a@example.com", threadId: "a@example.com-0" },
    ];

    const result = await Effect.runPromise(
      bulkMutateThreads({ operation: { kind: "trash" }, threads: selection })
    );

    expect(
      state.calls.map((call) => [call.accountId, call.threadIds.length])
    ).toStrictEqual([
      ["a@example.com", 250],
      ["a@example.com", 50],
      ["b@example.com", 2],
    ]);
    expect(result.succeeded).toHaveLength(300);
    expect(result.failed).toStrictEqual(threads("b@example.com", 2));
  });

  it("turns read state into the engine's read action", async () => {
    await Effect.runPromise(
      bulkMutateThreads({
        operation: { isUnread: true, kind: "setReadState" },
        threads: threads("a@example.com", 1),
      })
    );

    expect(state.calls[0]?.action).toStrictEqual({
      kind: "setRead",
      read: false,
    });
  });

  it("refuses an empty selection", async () => {
    await expect(
      Effect.runPromise(
        bulkMutateThreads({ operation: { kind: "trash" }, threads: [] })
      )
    ).rejects.toThrow("Select between 1 and 5000 conversations");
  });
});
