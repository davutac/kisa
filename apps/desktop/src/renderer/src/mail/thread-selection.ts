import type { MailThreadSummary } from "@/shared/ipc/mail";

export type ThreadSelectionDirection = -1 | 1;

export interface ThreadSelection {
  accountId: string;
  threadId: string;
}

/** How far a press on a row moves, in CSS pixels, before it paints rows. */
export const THREAD_SELECTION_DRAG_THRESHOLD = 15;
const THREAD_SELECTION_RAPID_NAVIGATION_INTERVAL_MS = 150;

export const getThreadSelectionKey = (
  thread: Pick<MailThreadSummary, "accountId" | "threadId">
): string => `${thread.accountId}:${thread.threadId}`;

export const getThreadSelectionScrollBehavior = (
  previousMoveAt: number | null,
  currentMoveAt: number
): "auto" | "smooth" =>
  previousMoveAt !== null &&
  currentMoveAt - previousMoveAt < THREAD_SELECTION_RAPID_NAVIGATION_INTERVAL_MS
    ? "auto"
    : "smooth";

export const parseThreadSelectionKey = (
  key: string
): ThreadSelection | null => {
  const separatorIndex = key.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === key.length - 1) {
    return null;
  }

  return {
    accountId: key.slice(0, separatorIndex),
    threadId: key.slice(separatorIndex + 1),
  };
};

export interface ThreadRowBounds {
  end: number;
  index: number;
  start: number;
}

/**
 * Where a fresh selection lands while the list is scrolled: the first row in
 * view going down, the last one going up. Rows count as in view by their
 * midpoint, so a sliver clipped at either edge is not what the keys jump to.
 */
export const getVisibleThreadSelectionIndex = (
  rows: readonly ThreadRowBounds[],
  viewportStart: number,
  viewportEnd: number,
  direction: ThreadSelectionDirection
): number | null => {
  let match: number | null = null;

  for (const row of rows) {
    const midpoint = (row.start + row.end) / 2;

    if (midpoint < viewportStart || midpoint > viewportEnd) {
      continue;
    }

    if (
      match === null ||
      (direction === 1 ? row.index < match : row.index > match)
    ) {
      match = row.index;
    }
  }

  return match;
};

/**
 * The row to select when the selected one leaves the list, as an action on it
 * shows at once: the next row still listed, or the one before it at the end.
 * `undefined` keeps the selection as it is.
 */
export const getSelectionAfterRemoval = (
  previousKeys: readonly string[],
  threadKeys: readonly string[],
  selectedThreadKey: string | null
): string | undefined => {
  if (selectedThreadKey === null || threadKeys.includes(selectedThreadKey)) {
    return undefined;
  }

  const removedIndex = previousKeys.indexOf(selectedThreadKey);

  if (removedIndex === -1) {
    return undefined;
  }

  const listed = new Set(threadKeys);
  const isListed = (key: string): boolean => listed.has(key);

  return (
    previousKeys.slice(removedIndex + 1).find(isListed) ??
    previousKeys.slice(0, removedIndex).findLast(isListed)
  );
};
