// Oxlint does not recognize @effect/vitest's it.effect as a test declaration.
// oxlint-disable vitest/no-standalone-expect
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { runAiCommand } from "../src/main/ai/process";

/** A real child process that runs until it is stopped. */
const lingering = {
  args: ["-e", "setInterval(() => {}, 1000)"],
  command: process.execPath,
  cwd: process.cwd(),
  env: process.env,
};

describe("running an AI command", () => {
  it.effect("fails with a timeout when the command runs too long", () =>
    Effect.gen(function* timesOut() {
      const command = yield* Effect.forkChild(
        runAiCommand({ ...lingering, timeoutMs: 30_000 }).pipe(Effect.flip)
      );
      yield* TestClock.adjust(30_000);

      const error = yield* Fiber.join(command);

      expect(error.kind).toBe("timeout");
    })
  );

  it.effect("returns the output of a command that finishes in time", () =>
    Effect.gen(function* finishes() {
      const result = yield* runAiCommand({
        ...lingering,
        args: ["-e", "process.stdout.write('done')"],
        timeoutMs: 30_000,
      });

      expect(result).toStrictEqual({ exitCode: 0, stderr: "", stdout: "done" });
    })
  );
});
