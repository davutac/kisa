// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { beforeEach, vi } from "vitest";

import { MAIL_REINDEX_CHANNEL } from "../src/shared/ipc/channels";
import type { MailIndexProgress } from "../src/shared/ipc/mail";

const state = vi.hoisted(() => ({
  getMailEngineIndexProgress: vi.fn<() => MailIndexProgress[]>(() => []),
  requestMailSync: vi.fn<(accountId?: string) => void>(),
}));

vi.mock("../src/main/mail/engine/mail-engine", () => ({
  getMailEngineIndexProgress: state.getMailEngineIndexProgress,
  requestMailSync: state.requestMailSync,
}));

const { getIndexProgress, reindexMail } =
  await import("../src/main/ipc/methods/mail-index");

describe("mail reindex IPC", () => {
  beforeEach(() => {
    state.getMailEngineIndexProgress.mockClear();
    state.requestMailSync.mockClear();
  });

  it.effect("returns the current progress snapshot", () =>
    Effect.gen(function* getMailIndexProgressThroughIpc() {
      expect(yield* getIndexProgress.handler(undefined)).toStrictEqual({
        accounts: [],
      });
      expect(state.getMailEngineIndexProgress).toHaveBeenCalledOnce();
    })
  );

  it.effect("wakes the account's sync for the validated account", () =>
    Effect.gen(function* reindexMailThroughIpc() {
      const reply = yield* reindexMail.handler({
        accountId: "person@example.com",
      });

      expect(reindexMail.channel).toBe(MAIL_REINDEX_CHANNEL);
      // Sync now is the user asking, which also retries a refused sign-in.
      expect(state.requestMailSync).toHaveBeenCalledWith(
        "person@example.com",
        "user"
      );
      expect(reply).toStrictEqual({ data: undefined, ok: true });
    })
  );

  it.effect("rejects an empty account id", () =>
    Effect.gen(function* rejectsAnEmptyAccountId() {
      const error = yield* Effect.flip(reindexMail.handler({ accountId: "" }));

      expect(Schema.isSchemaError(error)).toBeTruthy();
      expect(state.requestMailSync).not.toHaveBeenCalled();
    })
  );
});
