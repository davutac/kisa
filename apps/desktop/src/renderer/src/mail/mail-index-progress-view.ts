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
    return "Kisa cannot sign in to this account. Select Sync now to try again. A Microsoft account signs in again through Add account; any other account has to be disconnected and added again.";
  }

  if (entry?.status === "failed") {
    return "Kisa cannot reach this account's mail server and keeps trying. Select Sync now to try again now.";
  }

  return "Kisa keeps this account's mail downloaded, searchable, and up to date on its own.";
};
