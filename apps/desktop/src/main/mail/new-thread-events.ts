import type { ThreadId } from "@repo/gmail/models";

export interface NewGmailThreads {
  readonly accountId: string;
  readonly threadIds: readonly ThreadId[];
}

type NewGmailThreadsListener = (event: NewGmailThreads) => void;

const listeners = new Set<NewGmailThreadsListener>();

export const publishNewGmailThreads = (event: NewGmailThreads): void => {
  for (const listener of listeners) {
    listener(event);
  }
};

export const subscribeNewGmailThreads = (
  listener: NewGmailThreadsListener
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
