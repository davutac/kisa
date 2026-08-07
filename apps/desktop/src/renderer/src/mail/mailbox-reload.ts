import { useSyncExternalStore } from "react";

import { clearMailboxThreadsSnapshots } from "./mailbox-cache";

let reloadRevision = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): number => reloadRevision;

export const requestMailboxReload = (): void => {
  clearMailboxThreadsSnapshots();
  reloadRevision += 1;

  for (const listener of listeners) {
    listener();
  }
};

export const useMailboxReloadRevision = (): number =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
