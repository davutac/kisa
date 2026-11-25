type AccountConnectedListener = (email: string) => void;

const listeners = new Set<AccountConnectedListener>();

/**
 * A deliberately dependency-free hop between authentication and mail.
 *
 * Connecting an account has to start its mail sync, but `auth` importing the
 * engine directly closes a cycle: the engine opens connections with
 * credentials from `auth`. Publishing the event here leaves both sides
 * depending only on this module, which depends on nothing.
 */
export const onAccountConnected = (
  listener: AccountConnectedListener
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

export const notifyAccountConnected = (email: string): void => {
  for (const listener of listeners) {
    listener(email);
  }
};
