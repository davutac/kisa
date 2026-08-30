export interface IndexSample {
  readonly at: number;
  readonly indexedThreads: number;
}

export interface AccountSamples {
  readonly first: IndexSample;
  readonly latest: IndexSample;
}

/**
 * Structurally satisfied by `GmailIndexProgress`. Taking the minimum shape
 * keeps this module free of the IPC contract and trivially testable.
 */
export interface IndexEtaInput {
  readonly accountId: string;
  readonly estimatedThreads?: number;
  readonly indexedThreads: number;
  readonly status: string;
}

/**
 * How much of a run has to be observed before an estimate is worth showing.
 * Below this the throughput reading is dominated by whatever the indexer
 * happened to be doing in that instant — a page landing, or a governor wait —
 * and the estimate swings wildly enough to be worse than nothing.
 */
const MIN_ELAPSED_MS = 15_000;
const MIN_THREAD_DELTA = 20;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Estimates remaining time from throughput actually observed this session,
 * rather than from the configured rate.
 *
 * Measuring beats calculating here: the indexer's real pace is shaped by
 * governor backoff, foreground contention and Gmail's own latency, and a
 * figure derived from `units per second` would confidently disagree with what
 * the user can see happening.
 *
 * Sampling deliberately starts when the run is observed, not at the persisted
 * `startedAt`: that timestamp survives restarts, so elapsed wall-clock since
 * then includes every hour the app was closed and would understate throughput
 * enormously.
 */
export const estimateRemainingMs = (
  first: IndexSample,
  latest: IndexSample,
  remainingThreads: number
): number | undefined => {
  const elapsed = latest.at - first.at;
  const indexed = latest.indexedThreads - first.indexedThreads;

  if (
    elapsed < MIN_ELAPSED_MS ||
    indexed < MIN_THREAD_DELTA ||
    remainingThreads <= 0
  ) {
    return undefined;
  }

  return Math.round(remainingThreads / (indexed / elapsed));
};

/**
 * Deliberately coarse. The underlying estimate is not accurate to the minute,
 * so rendering it to the second would imply a precision it does not have.
 */
export const formatRemaining = (milliseconds: number): string => {
  if (milliseconds >= DAY_MS) {
    return "over a day left";
  }

  if (milliseconds < MINUTE_MS) {
    return "less than a minute left";
  }

  if (milliseconds < HOUR_MS) {
    return `~${Math.round(milliseconds / MINUTE_MS)} min left`;
  }

  const hours = Math.floor(milliseconds / HOUR_MS);
  const minutes = Math.round((milliseconds % HOUR_MS) / MINUTE_MS);

  // Rounding can push the remainder to a full hour; carry it rather than
  // rendering "2 h 60 min".
  if (minutes === 60) {
    return `~${hours + 1} h left`;
  }

  return minutes === 0 ? `~${hours} h left` : `~${hours} h ${minutes} min left`;
};

/**
 * Estimates are quantised to half a minute. The display rounds to whole
 * minutes anyway, so this keeps the value stable across most progress ticks
 * and lets an unchanged result be recognised and discarded.
 */
const ETA_QUANTUM_MS = 30_000;

/**
 * Folds a progress update into the running samples and returns the current
 * estimates. `samples` is an accumulator owned by the caller and mutated here —
 * it is per-subscription state, not shared.
 */
export const advanceEtas = (
  samples: Map<string, AccountSamples>,
  progress: readonly IndexEtaInput[],
  now: number
): ReadonlyMap<string, number> => {
  const etas = new Map<string, number>();

  for (const entry of progress) {
    if (entry.status !== "running") {
      // Dropping the samples restarts the measurement, so a paused account does
      // not carry stale throughput across the gap.
      samples.delete(entry.accountId);
      continue;
    }

    const sample = { at: now, indexedThreads: entry.indexedThreads };
    const existing = samples.get(entry.accountId);
    // A count that went backwards means a different run; start over rather
    // than measuring across the discontinuity.
    const merged =
      existing === undefined ||
      sample.indexedThreads < existing.first.indexedThreads
        ? { first: sample, latest: sample }
        : { first: existing.first, latest: sample };

    samples.set(entry.accountId, merged);

    if (entry.estimatedThreads === undefined) {
      continue;
    }

    const remaining = estimateRemainingMs(
      merged.first,
      merged.latest,
      entry.estimatedThreads - entry.indexedThreads
    );

    if (remaining !== undefined) {
      etas.set(
        entry.accountId,
        Math.round(remaining / ETA_QUANTUM_MS) * ETA_QUANTUM_MS
      );
    }
  }

  return etas;
};
