import { QUOTA_UNITS } from "./quota-governor";

export type BatchableThreadMutationKind = "setLabel" | "setReadState" | "trash";
export type ThreadMutationKind =
  | BatchableThreadMutationKind
  | "deleteForever"
  | "moveToInbox"
  | "moveToSpam";

export interface BulkThreadMutationPlan {
  readonly batches: readonly (readonly number[])[];
  readonly fallback: readonly number[];
}

const GMAIL_BATCH_MESSAGE_LIMIT = 1000;

/**
 * `messages.batchModify` has a fixed cost. Use it only when it is strictly
 * cheaper than the equivalent thread endpoint calls; equality keeps the
 * thread path because it preserves Gmail's native whole-thread semantics.
 */
export const shouldBatchThreadMutation = (
  kind: BatchableThreadMutationKind,
  threadCount: number
): boolean => {
  const perThreadUnits =
    kind === "trash" ? QUOTA_UNITS.threadsTrash : QUOTA_UNITS.threadsModify;

  return QUOTA_UNITS.messagesBatchModify < perThreadUnits * threadCount;
};

/**
 * Plans with indexes so the caller retains its richer thread records. Missing
 * membership, drafts, and oversized single threads are represented as an
 * unknown count and stay on Gmail's whole-thread endpoint.
 */
export const planBulkThreadMutation = (
  kind: ThreadMutationKind,
  messageCounts: readonly (number | undefined)[]
): BulkThreadMutationPlan => {
  if (
    kind === "deleteForever" ||
    kind === "moveToInbox" ||
    kind === "moveToSpam"
  ) {
    return { batches: [], fallback: messageCounts.map((_, index) => index) };
  }

  const candidateBatches: number[][] = [];
  const fallback: number[] = [];
  let currentBatch: number[] = [];
  let currentMessageCount = 0;

  for (const [index, messageCount] of messageCounts.entries()) {
    if (
      messageCount === undefined ||
      messageCount <= 0 ||
      messageCount > GMAIL_BATCH_MESSAGE_LIMIT
    ) {
      fallback.push(index);
      continue;
    }

    if (currentMessageCount + messageCount > GMAIL_BATCH_MESSAGE_LIMIT) {
      candidateBatches.push(currentBatch);
      currentBatch = [];
      currentMessageCount = 0;
    }

    currentBatch.push(index);
    currentMessageCount += messageCount;
  }

  if (currentBatch.length > 0) {
    candidateBatches.push(currentBatch);
  }

  const batches: number[][] = [];

  for (const batch of candidateBatches) {
    if (shouldBatchThreadMutation(kind, batch.length)) {
      batches.push(batch);
    } else {
      fallback.push(...batch);
    }
  }

  return { batches, fallback };
};
