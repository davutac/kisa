import * as Effect from "effect/Effect";

import { AiCategorizationError } from "./errors";
import type { AiCategorizationLabel } from "./prompts";

export interface ThreadCategorizationItem {
  readonly accountId: string;
  readonly threadId: string;
}

const categorizationError = (message: string) =>
  new AiCategorizationError({ message });

export const validateCategorizationLabelIds = Effect.fnUntraced(
  function* validateCategorizationLabelIds(
    generatedLabelIds: readonly string[],
    availableLabels: readonly AiCategorizationLabel[]
  ) {
    if (generatedLabelIds.length > 3) {
      return yield* categorizationError(
        "The AI categorization response contained more than three label ids"
      );
    }

    if (generatedLabelIds.some((labelId) => labelId.length === 0)) {
      return yield* categorizationError(
        "The AI categorization response contained an empty label id"
      );
    }

    if (new Set(generatedLabelIds).size !== generatedLabelIds.length) {
      return yield* categorizationError(
        "The AI categorization response contained duplicate label ids"
      );
    }

    const availableIds = new Set(availableLabels.map((label) => label.id));
    if (generatedLabelIds.some((labelId) => !availableIds.has(labelId))) {
      return yield* categorizationError(
        "The AI categorization response contained an unknown label id"
      );
    }

    return generatedLabelIds;
  }
);

export interface ThreadCategorizationQueueDependencies {
  readonly run: (
    item: ThreadCategorizationItem,
    signal: AbortSignal
  ) => Promise<void>;
}

export interface ThreadCategorizationQueue {
  readonly cancelAccount: (accountId: string) => void;
  readonly enqueue: (accountId: string, threadIds: readonly string[]) => void;
  readonly stop: () => Promise<void>;
}

const itemKey = (item: ThreadCategorizationItem): string =>
  `${item.accountId}\u0000${item.threadId}`;

export const createThreadCategorizationQueue = (
  dependencies: ThreadCategorizationQueueDependencies
): ThreadCategorizationQueue => {
  let pending: ThreadCategorizationItem[] = [];
  const keys = new Set<string>();
  let active:
    | {
        readonly completion: Promise<null>;
        readonly controller: AbortController;
        readonly item: ThreadCategorizationItem;
      }
    | undefined;
  let stopped = false;

  const drain = (): void => {
    if (stopped || active !== undefined) {
      return;
    }

    const item = pending.shift();
    if (item === undefined) {
      return;
    }

    const controller = new AbortController();
    const completion = Promise.withResolvers<null>();
    active = { completion: completion.promise, controller, item };

    const run = async (): Promise<void> => {
      try {
        await dependencies.run(item, controller.signal);
      } catch {
        // Each item is deliberately best-effort and is never retried.
      } finally {
        active = undefined;
        completion.resolve(null);
        drain();
      }
    };
    void run();
  };

  const enqueue = (accountId: string, threadIds: readonly string[]): void => {
    if (stopped) {
      return;
    }

    for (const threadId of threadIds) {
      const item = { accountId, threadId };
      const key = itemKey(item);
      if (keys.has(key)) {
        continue;
      }
      keys.add(key);
      pending.push(item);
    }
    drain();
  };

  const cancelAccount = (accountId: string): void => {
    pending = pending.filter((item) => item.accountId !== accountId);
    if (active?.item.accountId === accountId) {
      active.controller.abort();
    }
  };

  const stop = async (): Promise<void> => {
    stopped = true;
    pending = [];
    active?.controller.abort();
    await active?.completion;
    keys.clear();
  };

  return { cancelAccount, enqueue, stop };
};
