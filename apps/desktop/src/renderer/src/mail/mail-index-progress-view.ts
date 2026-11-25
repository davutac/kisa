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
    return "Kisa cannot sign in to this account. Sign in again, or select Sync now to try the saved sign-in.";
  }

  // The server answers and keeps the account's mail from mail apps: today
  // only Gmail, with All Mail hidden in its settings.
  if (entry?.status === "hidden") {
    return 'Gmail is not showing All Mail to Kisa, so this account cannot sync. In Gmail\'s settings, open Labels and turn on "Show in IMAP" for All Mail. Kisa keeps checking, or select Sync now.';
  }

  if (entry?.status === "failed") {
    return "Kisa cannot reach this account's mail server and keeps trying. Select Sync now to try again now.";
  }

  return "Kisa keeps this account's mail downloaded, searchable, and up to date on its own.";
};
