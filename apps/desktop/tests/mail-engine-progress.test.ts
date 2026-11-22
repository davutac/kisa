// The index progress the renderer receives, through the engine against the
// real SQLite store; only Electron-facing modules are replaced.
// oxlint-disable vitest/prefer-import-in-mock
import { Effect, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendRendererEvent } from "../src/main/electron/renderer-events";
import { forgetMailEngineAccount } from "../src/main/mail/engine/mail-engine";
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
});
