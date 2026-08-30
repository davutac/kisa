interface IndexRatioInput {
  readonly estimatedThreads?: number;
  readonly indexedThreads: number;
}

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
