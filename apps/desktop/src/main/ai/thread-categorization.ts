import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

import type { AiThreadCategorizationRequest } from "../../shared/ipc/ai";
import type { GmailLabelSummary } from "../../shared/ipc/mail";
import { withDatabaseClient } from "../database";
import { accountMailWorkSupervisor } from "../mail/account-mail-work-supervisor";
import { setThreadLabel, syncGmailLabelCatalog } from "../mail/mail-sync";
import { subscribeNewGmailThreads } from "../mail/new-thread-events";
import { isAutomaticCategorizationEnabled } from "../settings/account-settings";
import { getAiSettings } from "./ai-settings";
import { logDevelopmentAiError } from "./development-logging";
import { AiCategorizationError } from "./errors";
import { AiCategorizationGeneration } from "./generation-schemas";
import { requireAiModelSelection } from "./model-selection";
import {
  AI_CATEGORIZATION_SYSTEM_INSTRUCTIONS,
  buildCategorizationPrompt,
} from "./prompts";
import type { AiCategorizationLabel } from "./prompts";
import { generateStructuredText } from "./structured-generation";
import {
  createThreadCategorizationQueue,
  validateCategorizationLabelIds,
} from "./thread-categorization-core";
import type { ThreadCategorizationItem } from "./thread-categorization-core";
import { loadAiThreadContext } from "./thread-context";

const categorizationError = (message: string) =>
  new AiCategorizationError({ message });

const categorizationGenerationSemaphore = Semaphore.makeUnsafe(1);

const loadCurrentThreadLabelIds = Effect.fn("loadCurrentThreadLabelIds")(
  function* loadCurrentThreadLabelIds(item: ThreadCategorizationItem) {
    return yield* withDatabaseClient((database) =>
      database.query.gmailMessages.findMany({
        columns: { labelIds: true },
        where: {
          accountEmail: item.accountId,
          threadId: item.threadId,
        },
      })
    ).pipe(
      Effect.map((rows) => new Set(rows.flatMap((row) => row.labelIds ?? []))),
      Effect.mapError(() =>
        categorizationError("Could not load current Gmail labels")
      )
    );
  }
);

const toCategorizationLabels = (
  labels: readonly GmailLabelSummary[]
): readonly AiCategorizationLabel[] =>
  labels
    .filter((label) => label.type === "user")
    .map(({ id, name }) => ({ id, name }))
    .toSorted(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );

const selectThreadLabelIds = Effect.fn("selectThreadLabelIds")(
  function* selectThreadLabelIds(item: ThreadCategorizationItem) {
    const catalog = yield* syncGmailLabelCatalog({
      accountId: item.accountId,
    });
    const labels = toCategorizationLabels(catalog.labels);
    if (labels.length === 0) {
      return [];
    }

    const [settings, context, currentLabelIds] = yield* Effect.all(
      [
        getAiSettings(),
        loadAiThreadContext(item),
        loadCurrentThreadLabelIds(item),
      ],
      { concurrency: "unbounded" }
    );
    const model = yield* requireAiModelSelection(settings);
    const availableIds = new Set(labels.map((label) => label.id));
    const currentUserLabelIds = [...currentLabelIds]
      .filter((labelId) => availableIds.has(labelId))
      .toSorted();
    const generated = yield* categorizationGenerationSemaphore.withPermit(
      generateStructuredText({
        model,
        outputSchema: AiCategorizationGeneration,
        systemPrompt: AI_CATEGORIZATION_SYSTEM_INSTRUCTIONS,
        userPrompt: buildCategorizationPrompt({
          context,
          currentUserLabelIds,
          labels,
        }),
      }).pipe(Effect.scoped)
    );
    return yield* validateCategorizationLabelIds(generated.labelIds, labels);
  }
);

const applyThreadLabelIds = Effect.fn("applyThreadLabelIds")(
  function* applyThreadLabelIds(
    item: ThreadCategorizationItem,
    selectedLabelIds: readonly string[]
  ) {
    if (selectedLabelIds.length === 0) {
      return [];
    }

    const latestLabelIds = yield* loadCurrentThreadLabelIds(item);
    const missingLabelIds = selectedLabelIds.filter(
      (labelId) => !latestLabelIds.has(labelId)
    );
    yield* Effect.all(
      missingLabelIds.map((labelId) =>
        setThreadLabel({
          accountId: item.accountId,
          applied: true,
          labelId,
          threadId: item.threadId,
        })
      ),
      { concurrency: 1, discard: true }
    );
    return missingLabelIds;
  }
);

export const categorizeThread = Effect.fn("categorizeThread")(
  function* categorizeThread(request: AiThreadCategorizationRequest) {
    const selectedLabelIds = yield* selectThreadLabelIds(request);
    const labelIds = yield* applyThreadLabelIds(request, selectedLabelIds);
    return { labelIds };
  }
);

const attemptThreadCategorization = Effect.fn("attemptThreadCategorization")(
  function* attemptThreadCategorization(item: ThreadCategorizationItem) {
    if (!(yield* isAutomaticCategorizationEnabled(item.accountId))) {
      return;
    }

    const selectedLabelIds = yield* selectThreadLabelIds(item);
    if (
      selectedLabelIds.length === 0 ||
      !(yield* isAutomaticCategorizationEnabled(item.accountId))
    ) {
      return;
    }

    yield* applyThreadLabelIds(item, selectedLabelIds);
  }
);

const liveQueue = createThreadCategorizationQueue({
  run: async (item, signal) => {
    await accountMailWorkSupervisor.run(
      item.accountId,
      async (accountSignal) => {
        await Effect.runPromise(
          attemptThreadCategorization(item).pipe(
            Effect.catch((error) =>
              Effect.sync(() =>
                logDevelopmentAiError("Automatic thread categorization", error)
              ).pipe(
                Effect.andThen(
                  Effect.logWarning(
                    "Automatic categorization attempt ended without applying all labels"
                  )
                )
              )
            )
          ),
          { signal: accountSignal }
        );
      },
      signal
    );
  },
});

let unsubscribeNewThreads: (() => void) | undefined;

export const startThreadCategorization = (): void => {
  unsubscribeNewThreads ??= subscribeNewGmailThreads((event) => {
    liveQueue.enqueue(event.accountId, event.threadIds);
  });
};

export const cancelThreadCategorization = (accountId: string): void => {
  liveQueue.cancelAccount(accountId);
};

export const stopThreadCategorization = async (): Promise<void> => {
  unsubscribeNewThreads?.();
  unsubscribeNewThreads = undefined;
  await liveQueue.stop();
};
