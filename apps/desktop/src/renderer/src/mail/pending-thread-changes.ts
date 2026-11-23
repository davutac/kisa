import { useSyncExternalStore } from "react";

import type {
  MailBulkThreadMutationOperation,
  MailThreadRequest,
  MailThreadSummary,
} from "@/shared/ipc/mail";

import { withLabelState } from "./label";
import { getThreadSelectionKey } from "./thread-selection";

/**
 * A thread action as it will look once the server has it. A label change
 * carries the label's name too, since conversations list user labels by name.
 */
export type PendingThreadChange =
  | Exclude<MailBulkThreadMutationOperation, { readonly kind: "setLabel" }>
  | (Extract<MailBulkThreadMutationOperation, { readonly kind: "setLabel" }> & {
      readonly labelName: string;
    });

/** Each pending conversation's changes, oldest first, by selection key. */
export type PendingThreadChanges = ReadonlyMap<
  string,
  readonly PendingThreadChange[]
>;

interface PendingEntry {
  readonly change: PendingThreadChange;
  readonly keys: readonly string[];
}

interface ProjectedThread {
  readonly isUnread: boolean;
  readonly labels: readonly string[];
}

const withLabels = (
  labels: readonly string[],
  added: string,
  removed: readonly string[]
): readonly string[] => [
  ...labels.filter((label) => label !== added && !removed.includes(label)),
  added,
];

/** `undefined` once the conversation is deleted. */
const applyChange = (
  thread: ProjectedThread,
  change: PendingThreadChange
): ProjectedThread | undefined => {
  switch (change.kind) {
    case "deleteForever": {
      return undefined;
    }
    case "moveToInbox": {
      return {
        ...thread,
        labels: withLabels(thread.labels, "INBOX", ["SPAM", "TRASH"]),
      };
    }
    case "moveToSpam": {
      return {
        ...thread,
        labels: withLabels(thread.labels, "SPAM", ["INBOX"]),
      };
    }
    case "setLabel": {
      return {
        ...thread,
        labels: withLabelState(thread.labels, change.labelName, change.applied),
      };
    }
    case "setReadState": {
      return {
        isUnread: change.isUnread,
        labels: withLabelState(thread.labels, "UNREAD", change.isUnread),
      };
    }
    case "trash": {
      return {
        ...thread,
        labels: withLabels(thread.labels, "TRASH", ["INBOX"]),
      };
    }
    default: {
      return change satisfies never;
    }
  }
};

/**
 * A listed conversation as its pending actions will leave it, or `undefined`
 * when one deletes it. The row itself stays as the cache has it.
 */
export const projectThreadSummary = (
  thread: MailThreadSummary,
  pending: PendingThreadChanges
): MailThreadSummary | undefined => {
  const changes = pending.get(getThreadSelectionKey(thread));

  if (changes === undefined) {
    return thread;
  }

  let projected: ProjectedThread | undefined = thread;

  for (const change of changes) {
    projected = applyChange(projected, change);

    if (projected === undefined) {
      return undefined;
    }
  }

  return { ...thread, isUnread: projected.isUnread, labels: projected.labels };
};

export const projectThreadSummaries = (
  threads: readonly MailThreadSummary[],
  pending: PendingThreadChanges
): readonly MailThreadSummary[] =>
  pending.size === 0
    ? threads
    : threads.flatMap((thread) => {
        const projected = projectThreadSummary(thread, pending);
        return projected === undefined ? [] : [projected];
      });

/**
 * An open conversation's labels under its pending actions. Deleting it leaves
 * them as they were: whoever deleted it also closes it.
 */
export const projectThreadLabels = (
  thread: MailThreadRequest & { readonly labels: readonly string[] },
  pending: PendingThreadChanges
): readonly string[] => {
  const changes = pending.get(getThreadSelectionKey(thread));

  if (changes === undefined) {
    return thread.labels;
  }

  let projected: ProjectedThread = {
    isUnread: thread.labels.includes("UNREAD"),
    labels: thread.labels,
  };

  for (const change of changes) {
    projected = applyChange(projected, change) ?? projected;
  }

  return projected.labels;
};

/** The labels a conversation has changes to on their way to the server. */
export const getPendingLabelIds = (
  thread: MailThreadRequest,
  pending: PendingThreadChanges
): ReadonlySet<string> =>
  new Set(
    (pending.get(getThreadSelectionKey(thread)) ?? []).flatMap((change) =>
      change.kind === "setLabel" ? [change.labelId] : []
    )
  );

// One store per window: what this window has asked of the server and not yet
// heard back about. Other windows learn of a change when the server confirms
// it, through the thread list event.
const EMPTY: PendingThreadChanges = new Map();
const entries = new Set<PendingEntry>();
const listeners = new Set<() => void>();
let snapshot = EMPTY;

const publish = (): void => {
  const byThread = new Map<string, PendingThreadChange[]>();

  for (const entry of entries) {
    for (const key of entry.keys) {
      byThread.set(key, [...(byThread.get(key) ?? []), entry.change]);
    }
  }

  snapshot = byThread.size === 0 ? EMPTY : byThread;

  for (const listener of listeners) {
    listener();
  }
};

/**
 * Shows a change on the given conversations until the returned function is
 * called, which the caller does once the server has answered: the cache, and
 * the thread list event that reports it, are the truth from then on.
 */
export const beginPendingThreadChange = (
  threads: readonly MailThreadRequest[],
  change: PendingThreadChange
): (() => void) => {
  const entry: PendingEntry = {
    change,
    keys: threads.map((thread) => getThreadSelectionKey(thread)),
  };

  entries.add(entry);
  publish();

  return () => {
    if (entries.delete(entry)) {
      publish();
    }
  };
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

/** What this window has pending now; a new map whenever that changes. */
export const getPendingThreadChanges = (): PendingThreadChanges => snapshot;

export const usePendingThreadChanges = (): PendingThreadChanges =>
  useSyncExternalStore(
    subscribe,
    getPendingThreadChanges,
    getPendingThreadChanges
  );
