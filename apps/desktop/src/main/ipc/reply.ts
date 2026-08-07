import * as Effect from "effect/Effect";

import type { IpcReply } from "../../shared/ipc/reply";

export const toIpcReply = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  fallbackMessage: string
): Effect.Effect<IpcReply<A>, never, R> =>
  effect.pipe(
    Effect.match({
      onFailure: (error) => ({
        error: error instanceof Error ? error.message : fallbackMessage,
        ok: false as const,
      }),
      onSuccess: (data) => ({ data, ok: true as const }),
    })
  );
