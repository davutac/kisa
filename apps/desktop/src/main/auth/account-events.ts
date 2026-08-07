type AccountConnectedListener = (email: string) => void;

const listeners = new Set<AccountConnectedListener>();

/**
 * A deliberately dependency-free hop between authentication and mail.
 *
 * Connecting an account has to start its mail index, but `auth` importing the
 * indexer directly closes a cycle: the indexer reads through the Gmail store,
 * and the store mints access tokens from `auth`. Publishing the event here
 * leaves both sides depending only on this module, which depends on nothing.
 */
export const onGoogleAccountConnected = (
  listener: AccountConnectedListener
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const notifyGoogleAccountConnected = (email: string): void => {
  for (const listener of listeners) {
    listener(email);
  }
};
