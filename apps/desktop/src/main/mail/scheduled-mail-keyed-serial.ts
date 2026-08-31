import { Effect, TxSemaphore } from "effect";

import { scheduledMailError } from "./scheduled-mail-error";

interface SerialKey {
  readonly accountId: string;
  readonly draftId: string;
}

interface KeyLock {
  readonly semaphore: TxSemaphore.TxSemaphore;
  users: number;
}

const keyedSerialError = (
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection values are unknown at this adapter boundary.
  error: unknown
) =>
  scheduledMailError(
    error instanceof Error ? error.message : "Scheduled mail operation failed"
  );

export const getScheduledMailKeyId = (key: SerialKey): string =>
  `${key.accountId}\0${key.draftId}`;

export class ScheduledMailKeyedSerial {
  readonly #locks = new Map<string, KeyLock>();

  run<A>(key: SerialKey, work: () => Promise<A>): Promise<A> {
    return Effect.runPromise(
      this.runEffect(
        key,
        Effect.tryPromise({ catch: keyedSerialError, try: work })
      )
    );
  }

  runEffect<A, E>(
    key: SerialKey,
    effect: Effect.Effect<A, E>
  ): Effect.Effect<A, E> {
    const id = getScheduledMailKeyId(key);
    return Effect.acquireUseRelease(
      Effect.gen(
        function* acquireKeyLock(this: ScheduledMailKeyedSerial) {
          const existing = this.#locks.get(id);
          if (existing !== undefined) {
            existing.users += 1;
            return existing;
          }
          const created = {
            semaphore: yield* TxSemaphore.make(1),
            users: 1,
          };
          this.#locks.set(id, created);
          return created;
        }.bind(this)
      ),
      (lock) => TxSemaphore.withPermit(lock.semaphore, effect),
      (lock) =>
        Effect.sync(() => {
          lock.users -= 1;
          if (lock.users === 0 && this.#locks.get(id) === lock) {
            this.#locks.delete(id);
          }
        })
    );
  }
}
