interface IndexStatusInput {
  readonly status: string;
}

/** Settings copy reports the persisted lifecycle without exposing raw errors. */
export const toMailIndexDescription = (
  entry: IndexStatusInput | undefined
): string => {
  if (entry?.status === "running") {
    return "Downloading and indexing your mail…";
  }

  if (entry?.status === "paused") {
    return "Mail sync is paused until this account is reconnected.";
  }

  if (entry?.status === "failed") {
    return "Kisa cannot reach this account's mail server and keeps trying. Select Sync now to try again now.";
  }

  return "Kisa keeps this account's mail downloaded, searchable, and up to date on its own.";
};
