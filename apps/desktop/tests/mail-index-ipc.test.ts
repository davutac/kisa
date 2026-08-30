// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable unicorn/no-useless-undefined vitest/no-standalone-expect vitest/prefer-import-in-mock
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { beforeEach, vi } from "vitest";

import { MAIL_REINDEX_CHANNEL } from "../src/shared/ipc/channels";
import type { GmailIndexProgress } from "../src/shared/ipc/mail";

const state = vi.hoisted(() => ({
  getMailIndexProgress: vi.fn<() => GmailIndexProgress[]>(() => []),
  reindexMailAccount: vi.fn<(accountId: string) => Effect.Effect<void>>(
    () => Effect.void
  ),
}));

vi.mock("../src/main/mail/mail-backfill", () => ({
  getMailIndexProgress: state.getMailIndexProgress,
  reindexMailAccount: state.reindexMailAccount,
}));

const { getIndexProgress, reindexMail } =
  await import("../src/main/ipc/methods/mail-index");

describe("mail reindex IPC", () => {
  beforeEach(() => {
    state.getMailIndexProgress.mockClear();
    state.reindexMailAccount.mockClear();
  });

  it.effect("returns the current progress snapshot", () =>
    Effect.gen(function* getMailIndexProgressThroughIpc() {
      expect(yield* getIndexProgress.handler(undefined)).toStrictEqual({
        accounts: [],
      });
      expect(state.getMailIndexProgress).toHaveBeenCalledOnce();
    })
  );

  it.effect("starts a reindex for the validated account", () =>
    Effect.gen(function* reindexMailThroughIpc() {
      const reply = yield* reindexMail.handler({
        accountId: "person@example.com",
      });

      expect(reindexMail.channel).toBe(MAIL_REINDEX_CHANNEL);
      expect(state.reindexMailAccount).toHaveBeenCalledWith(
        "person@example.com"
      );
      expect(reply).toStrictEqual({ data: undefined, ok: true });
    })
  );

  it("rejects an empty account id", async () => {
    const exit = await Effect.runPromiseExit(
      reindexMail.handler({ accountId: "" })
    );

    expect(Exit.isFailure(exit)).toBeTruthy();
    expect(state.reindexMailAccount).not.toHaveBeenCalled();
  });
});
