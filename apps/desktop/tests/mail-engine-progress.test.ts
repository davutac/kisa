// The index progress the renderer receives, through the engine against the
// real SQLite store; only Electron-facing modules are replaced.
// oxlint-disable vitest/prefer-import-in-mock
import { Effect, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendRendererEvent } from "../src/main/electron/renderer-events";
import {
  forgetMailEngineAccount,
  toMailIndexProgress,
} from "../src/main/mail/engine/mail-engine";
import { MAIL_INDEX_PROGRESS_CHANNEL } from "../src/shared/ipc/channels";
import { MailIndexProgressList } from "../src/shared/ipc/mail";
import {
  accountId,
  insertAccount,
  resetDatabase,
} from "./fixtures/mail-engine-harness";

vi.mock("../src/main/database", async () => {
  const { remoteDatabase } = await import("./fixtures/mail-engine-harness");
  const { Effect: MockEffect } = await import("effect");
  return {
    withDatabaseClient: <A>(
      run: (database: typeof remoteDatabase) => Promise<A>
    ) => MockEffect.promise(() => run(remoteDatabase)),
  };
});
vi.mock("../src/main/mail/new-mail-notifications", () => ({
  dismissInactiveThreadNotifications: vi.fn<() => void>(),
}));
vi.mock("../src/main/electron/renderer-events", () => ({
  sendRendererEvent: vi.fn<() => void>(),
}));
vi.mock("../src/main/mail/unread-badge", async () => {
  const { Effect: MockEffect } = await import("effect");
  return { refreshUnreadBadge: () => MockEffect.void };
});

describe("index progress for the renderer", () => {
  beforeEach(() => {
    resetDatabase();
    vi.mocked(sendRendererEvent).mockClear();
  });

  it("lists every account, in the shape the preload decodes", async () => {
    insertAccount("generic");

    await Effect.runPromise(forgetMailEngineAccount(accountId));

    const payloads = vi
      .mocked(sendRendererEvent)
      .mock.calls.filter(([channel]) => channel === MAIL_INDEX_PROGRESS_CHANNEL)
      .map((call) => call[2]);
    // The renderer replaces its whole list with each event, so a forgotten
    // account has to arrive as an empty list, not as silence.
    expect(payloads).toStrictEqual([{ accounts: [] }]);
    expect(Schema.is(MailIndexProgressList)(payloads[0])).toBeTruthy();
  });

  // The worker overrides the counted status with the account's trouble, and
  // the preload decodes what main sends: a status it does not know would
  // drop the whole list.
  it("sends an account whose mail is hidden in a shape the preload decodes", () => {
    const hidden = {
      ...toMailIndexProgress("person@example.com", {
        estimatedMessages: 10,
        oldestIndexedAt: 5,
        pendingBodies: 0,
        totalMessages: 10,
        unfinishedMailboxes: 0,
      }),
      status: "hidden",
    };

    expect(
      Schema.is(MailIndexProgressList)({ accounts: [hidden] })
    ).toBeTruthy();
  });

  it("counts a body given up on as done, so the index can complete", () => {
    const counts = {
      estimatedMessages: 10,
      oldestIndexedAt: 5,
      pendingBodies: 0,
      totalMessages: 10,
      unfinishedMailboxes: 0,
    };

    // Of ten bodies, nine are ready and one failed: none is pending.
    expect(toMailIndexProgress("person@example.com", counts)).toMatchObject({
      indexedMessages: 10,
      status: "complete",
    });
    expect(
      toMailIndexProgress("person@example.com", { ...counts, pendingBodies: 2 })
    ).toMatchObject({ indexedMessages: 8, status: "running" });
    expect(
      toMailIndexProgress("person@example.com", {
        ...counts,
        unfinishedMailboxes: 1,
      })
    ).toMatchObject({ status: "running" });
  });
});
