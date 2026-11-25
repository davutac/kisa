import { Deferred, Effect, Schema } from "effect";

/**
 * Messages waiting out the Undo send delay, by account and draft.
 *
 * A held message is ready to go: its attachments were read when it was
 * sent, so it no longer depends on the window. Its saved draft stays put and
 * out of sight until the server has the message, so Undo, a failure, a quit
 * or a crash all leave the draft where the user can find it.
 *
 * Whoever settles `release` first decides: the delay running out or a quit
 * says send, Undo says cancel. Nothing here is persisted; after a restart the
 * draft is simply a draft again.
 */
interface HeldSend {
  /** Completes once the hold has ended, whichever way. */
  readonly done: Deferred.Deferred<true>;
  readonly ownerId: number;
  readonly release: Deferred.Deferred<"cancel" | "send">;
}

const held = new Map<string, HeldSend>();

const keyOf = (accountId: string, draftId: string): string =>
  `${accountId}\u0000${draftId}`;

// oxlint-disable-next-line unicorn/throw-new-error
export class HeldSendError extends Schema.TaggedError<
  HeldSendError,
  { readonly brand: unique symbol }
>()("HeldSendError", { message: Schema.String }) {}

export type HeldSendResult<A> =
  | { readonly kind: "canceled" }
  | { readonly kind: "sent"; readonly value: A };

/** Whether this draft belongs to a message waiting to be sent. */
export const isHeldDraft = (
  accountId: string | null | undefined,
  draftId: string
): boolean =>
  accountId !== null &&
  accountId !== undefined &&
  held.has(keyOf(accountId, draftId));

/**
 * Waits `delayMs`, then runs `send`, unless Undo takes the message back
 * first. A second send of the same draft while one is held is refused, so a
 * double press cannot send it twice. `whenSent` runs once the draft is no
 * longer held, as part of the hold, so a quit waits for it too: what follows
 * a send, such as deleting its draft, is not left for the next start.
 */
export const holdSend = Effect.fn("HeldSends.holdSend")(function* holdSend<
  A,
  E,
  R,
>(
  draft: { readonly accountId: string; readonly draftId: string },
  ownerId: number,
  delayMs: number,
  send: Effect.Effect<A, E, R>,
  whenSent: (value: A) => Effect.Effect<void> = () => Effect.void
) {
  const key = keyOf(draft.accountId, draft.draftId);

  if (held.has(key)) {
    return yield* new HeldSendError({
      message: "This message is already being sent",
    });
  }

  const entry: HeldSend = {
    done: yield* Deferred.make<true>(),
    ownerId,
    release: yield* Deferred.make<"cancel" | "send">(),
  };

  held.set(key, entry);

  const waitThenSend = Effect.gen(function* waitThenSend() {
    yield* Effect.race(
      Effect.sleep(delayMs).pipe(
        Effect.andThen(Deferred.succeed(entry.release, "send"))
      ),
      Deferred.await(entry.release)
    );

    if ((yield* Deferred.await(entry.release)) === "cancel") {
      return { kind: "canceled" } satisfies HeldSendResult<A>;
    }

    const value = yield* send;

    return { kind: "sent", value } satisfies HeldSendResult<A>;
  }).pipe(
    // Interrupted too, as when the account is disconnected: the draft is no
    // longer held and shows again.
    Effect.ensuring(
      Effect.sync(() => {
        held.delete(key);
      })
    )
  );

  return yield* Effect.gen(function* holdThenSettle() {
    const result = yield* waitThenSend;

    if (result.kind === "sent") {
      yield* whenSent(result.value);
    }

    return result;
  }).pipe(Effect.ensuring(Deferred.succeed(entry.done, true)));
});

/**
 * Undo for a held message, from the window that sent it. `too-late` once
 * the delay ran out or a quit released it: the message is on its way. A
 * canceled hold has ended by the time this answers, so its draft is visible.
 */
export const cancelHeldSend = Effect.fn("HeldSends.cancelHeldSend")(
  function* cancelHeldSend(
    draft: { readonly accountId: string; readonly draftId: string },
    ownerId: number
  ) {
    const entry = held.get(keyOf(draft.accountId, draft.draftId));

    if (entry === undefined) {
      return "too-late" as const;
    }

    if (entry.ownerId !== ownerId) {
      return yield* new HeldSendError({
        message: "Only the window that sent this message can undo it",
      });
    }

    if (!(yield* Deferred.succeed(entry.release, "cancel"))) {
      return "too-late" as const;
    }

    yield* Deferred.await(entry.done);

    return "canceled" as const;
  }
);

/**
 * Sends every held message now and waits for them, for quitting: what the
 * user sent should go out, not wait for the next start.
 */
export const releaseHeldSends = Effect.fn("HeldSends.releaseHeldSends")(
  function* releaseHeldSends() {
    const entries = [...held.values()];

    for (const entry of entries) {
      yield* Deferred.succeed(entry.release, "send");
    }

    yield* Effect.forEach(entries, (entry) => Deferred.await(entry.done), {
      discard: true,
    });
  }
);
