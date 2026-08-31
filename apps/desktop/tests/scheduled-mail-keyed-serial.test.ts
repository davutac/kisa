import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { ScheduledMailKeyedSerial } from "../src/main/mail/scheduled-mail-keyed-serial";

const key = { accountId: "one@example.com", draftId: "draft-1" };

describe(ScheduledMailKeyedSerial, () => {
  it("serializes Promise adapters and Effects through the same key lock", async () => {
    const serial = new ScheduledMailKeyedSerial();
    const releaseFirst = Promise.withResolvers<boolean>();
    const firstStarted = Promise.withResolvers<boolean>();
    const events: string[] = [];

    const first = serial.run(key, async () => {
      events.push("first-started");
      firstStarted.resolve(true);
      await releaseFirst.promise;
      events.push("first-finished");
    });
    await firstStarted.promise;
    const second = Effect.runPromise(
      serial.runEffect(
        key,
        Effect.sync(() => {
          events.push("second");
        })
      )
    );

    await Promise.resolve();
    expect(events).toStrictEqual(["first-started"]);
    releaseFirst.resolve(true);
    await Promise.all([first, second]);
    expect(events).toStrictEqual(["first-started", "first-finished", "second"]);
  });

  it("releases a key lock after a failed Effect", async () => {
    const serial = new ScheduledMailKeyedSerial();

    await expect(
      Effect.runPromise(serial.runEffect(key, Effect.fail("expected")))
    ).rejects.toBe("expected");
    await expect(
      Effect.runPromise(serial.runEffect(key, Effect.succeed("next")))
    ).resolves.toBe("next");
  });
});
