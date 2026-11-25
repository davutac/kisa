export interface NewMailThreads {
  readonly accountId: string;
  readonly threadIds: readonly string[];
}

type NewMailThreadsListener = (event: NewMailThreads) => void;

const listeners = new Set<NewMailThreadsListener>();

/** Conversations that began with mail that just arrived in the Inbox. */
export const publishNewMailThreads = (event: NewMailThreads): void => {
  for (const listener of listeners) {
    listener(event);
  }
};

export const subscribeNewMailThreads = (
  listener: NewMailThreadsListener
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};
