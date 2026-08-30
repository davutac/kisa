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
