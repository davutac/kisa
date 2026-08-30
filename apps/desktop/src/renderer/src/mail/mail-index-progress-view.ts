interface IndexRatioInput {
  readonly estimatedThreads?: number;
  readonly indexedThreads: number;
}

interface IndexStatusInput {
  readonly status: string;
}

/** Settings copy reports the persisted lifecycle without exposing raw errors. */
export const toMailIndexDescription = (
  entry: IndexStatusInput | undefined
): string => {
  if (entry?.status === "running") {
    return "Indexing your complete Gmail history…";
  }

  if (entry?.status === "paused") {
    return "Mail history indexing is paused until this account is reconnected.";
  }

  if (entry?.status === "failed") {
    return "Mail history indexing stopped. Reindex to try again.";
  }

  return "Refresh the local copy of your complete Gmail history.";
};

/** Gmail totals are estimates, so completed work is clamped to a full ring. */
export const toIndexRatio = (
  entry: IndexRatioInput | undefined
): number | undefined =>
  entry === undefined ||
  entry.estimatedThreads === undefined ||
  entry.estimatedThreads <= 0
    ? undefined
    : Math.min(1, entry.indexedThreads / entry.estimatedThreads);

/** A combined percentage is only honest when every active run is determinate. */
export const toOverallIndexRatio = (
  entries: readonly IndexRatioInput[]
): number | undefined => {
  if (entries.length === 0) {
    return undefined;
  }

  let total = 0;
  for (const entry of entries) {
    const ratio = toIndexRatio(entry);
    if (ratio === undefined) {
      return undefined;
    }
    total += ratio;
  }

  return total / entries.length;
};
