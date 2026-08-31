import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { makeAccountMailWorkSupervisor } from "../src/main/mail/account-mail-work-supervisor";

describe("account mail work supervisor", () => {
  it("aborts and joins every account writer before suspension completes", async () => {
    const supervisor = makeAccountMailWorkSupervisor();
    const events: string[] = [];
    const signals: AbortSignal[] = [];
    const firstRelease = Promise.withResolvers<null>();
    const secondRelease = Promise.withResolvers<null>();
    const started = Promise.withResolvers<null>();
    let startedCount = 0;
    const makeWork =
      (name: string, release: Promise<null>) =>
      async (signal: AbortSignal): Promise<void> => {
        signals.push(signal);
        startedCount += 1;
        if (startedCount === 2) {
          started.resolve(null);
        }

        await release;
        events.push(`${name}:settled`);
      };

    const first = supervisor.run(
      "user@example.com",
      makeWork("first", firstRelease.promise)
    );
    const second = supervisor.run(
      "user@example.com",
      makeWork("second", secondRelease.promise)
    );
    await started.promise;

    let suspensionCompleted = false;
    const suspension = Effect.runPromise(
      supervisor.suspend("user@example.com")
    ).then(() => {
      suspensionCompleted = true;
      events.push("suspended");
    });
    await Promise.resolve();

    expect(signals).toHaveLength(2);
    expect(signals.every(({ aborted }) => aborted)).toBeTruthy();
    expect(suspensionCompleted).toBeFalsy();

    firstRelease.resolve(null);
    await first;
    expect(suspensionCompleted).toBeFalsy();

    secondRelease.resolve(null);
    await Promise.all([second, suspension]);
    expect(events).toStrictEqual([
      "first:settled",
      "second:settled",
      "suspended",
    ]);
  });

  it("blocks only the suspended account and permits it again after resume", async () => {
    const supervisor = makeAccountMailWorkSupervisor();
    const runs: string[] = [];

    await Effect.runPromise(supervisor.suspend("paused@example.com"));
    await Promise.all([
      supervisor.run("paused@example.com", () =>
        Effect.runPromise(
          Effect.sync(() => {
            runs.push("paused");
          })
        )
      ),
      supervisor.run("other@example.com", () =>
        Effect.runPromise(
          Effect.sync(() => {
            runs.push("other");
          })
        )
      ),
    ]);

    expect(runs).toStrictEqual(["other"]);

    supervisor.resume("paused@example.com");
    await supervisor.run("paused@example.com", () =>
      Effect.runPromise(
        Effect.sync(() => {
          runs.push("resumed");
        })
      )
    );

    expect(runs).toStrictEqual(["other", "resumed"]);
  });

  it("stays suspended until every concurrent suspension is resumed", async () => {
    const supervisor = makeAccountMailWorkSupervisor();
    const runs: string[] = [];

    await Promise.all([
      Effect.runPromise(supervisor.suspend("paused@example.com")),
      Effect.runPromise(supervisor.suspend("paused@example.com")),
    ]);
    expect(supervisor.isSuspended("paused@example.com")).toBeTruthy();

    supervisor.resume("paused@example.com");
    await supervisor.run("paused@example.com", () => {
      runs.push("too-early");
      return Promise.resolve();
    });
    expect(supervisor.isSuspended("paused@example.com")).toBeTruthy();
    expect(runs).toStrictEqual([]);

    supervisor.resume("paused@example.com");
    await supervisor.run("paused@example.com", () => {
      runs.push("after-all-resumed");
      return Promise.resolve();
    });

    expect(supervisor.isSuspended("paused@example.com")).toBeFalsy();
    expect(runs).toStrictEqual(["after-all-resumed"]);
  });

  it("aborts supervised work when its parent is interrupted", async () => {
    const supervisor = makeAccountMailWorkSupervisor();
    const parent = new AbortController();
    const started = Promise.withResolvers<AbortSignal>();
    const completion = supervisor.run(
      "user@example.com",
      async (signal) => {
        started.resolve(signal);
        const aborted = Promise.withResolvers<null>();
        signal.addEventListener("abort", () => aborted.resolve(null), {
          once: true,
        });
        await aborted.promise;
      },
      parent.signal
    );

    const signal = await started.promise;
    parent.abort();
    await completion;

    expect(signal.aborted).toBeTruthy();
  });
});
