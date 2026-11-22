import { describe, expect, it } from "vitest";

import { runWithCleanup } from "../src/renderer/src/lib/run-with-cleanup";

describe(runWithCleanup, () => {
  it("returns the task's value after cleaning up", async () => {
    const events: string[] = [];

    const result = await runWithCleanup(
      async () => {
        await Promise.resolve();
        events.push("task");
        return 42;
      },
      () => {
        events.push("cleanup");
      }
    );

    events.push("caller");
    expect(result).toBe(42);
    expect(events).toStrictEqual(["task", "cleanup", "caller"]);
  });

  it("cleans up before rethrowing the task's failure", async () => {
    const failure = new Error("task failed");
    const events: string[] = [];

    await expect(
      runWithCleanup(
        async () => {
          await Promise.resolve();
          events.push("task");
          throw failure;
        },
        () => {
          events.push("cleanup");
        }
      )
    ).rejects.toBe(failure);
    expect(events).toStrictEqual(["task", "cleanup"]);
  });
});
