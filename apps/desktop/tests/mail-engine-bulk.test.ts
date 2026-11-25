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
  /** Conversations whose every cached copy is the user's own. */
  ownOnly: new Set<string>(),
  partitioned: [] as string[][],
}));

// Sending reaches drafts and settings, which need Electron; bulk actions
// use neither.
vi.mock("../src/main/mail/mail-drafts", () => ({}));
vi.mock("../src/main/settings/app-settings", () => ({}));

vi.mock("../src/main/mail/engine/mail-send", () => ({
  sendNewMessage: vi.fn<() => never>(),
  sendThreadMessage: vi.fn<() => never>(),
}));

vi.mock("../src/main/mail/engine/mail-engine", async () => {
  const { Effect: MockEffect, Schema } = await import("effect");
  // oxlint-disable-next-line unicorn/throw-new-error
  class MailEngineError extends Schema.TaggedError<
    MailEngineError,
    { readonly brand: unique symbol }
  >()("MailEngineError", { message: Schema.String }) {}

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
    partitionReportable: (_accountId: string, threadIds: readonly string[]) =>
      MockEffect.sync(() => {
        state.partitioned.push([...threadIds]);
        return {
          ownOnly: threadIds.filter((id) => state.ownOnly.has(id)),
          reportable: threadIds.filter((id) => !state.ownOnly.has(id)),
        };
      }),
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
    state.ownOnly.clear();
    state.partitioned.length = 0;
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
      ["a@example.com", 200],
      ["a@example.com", 100],
      ["b@example.com", 2],
    ]);
    expect(result.succeeded).toHaveLength(300);
    expect(result.failed).toStrictEqual(threads("b@example.com", 2));
  });

  it("fails a conversation of only the user's own mail alone when reporting spam", async () => {
    state.ownOnly.add("a@example.com-1");
    const selection = threads("a@example.com", 3);

    const result = await Effect.runPromise(
      bulkMutateThreads({
        operation: { kind: "moveToSpam" },
        threads: selection,
      })
    );

    expect({
      failed: result.failed,
      sent: state.calls.map((call) => call.threadIds),
      succeeded: result.succeeded,
    }).toStrictEqual({
      failed: [selection[1]],
      sent: [["a@example.com-0", "a@example.com-2"]],
      succeeded: [selection[0], selection[2]],
    });
  });

  it("asks no server when every conversation in a round is the user's own", async () => {
    state.ownOnly.add("a@example.com-0");

    const result = await Effect.runPromise(
      bulkMutateThreads({
        operation: { kind: "moveToSpam" },
        threads: threads("a@example.com", 1),
      })
    );

    expect({ calls: state.calls, failed: result.failed }).toStrictEqual({
      calls: [],
      failed: threads("a@example.com", 1),
    });
  });

  it("checks for the user's own mail only when reporting spam", async () => {
    await Effect.runPromise(
      bulkMutateThreads({
        operation: { kind: "trash" },
        threads: threads("a@example.com", 2),
      })
    );

    expect(state.partitioned).toStrictEqual([]);
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
