import type { GmailThreadSummary } from "@/shared/ipc/mail";

export type ThreadSelectionDirection = -1 | 1;

export interface ThreadSelection {
  accountId: string;
  threadId: string;
}

interface ThreadSelectionDragPoint {
  readonly x: number;
  readonly y: number;
}

const THREAD_SELECTION_DRAG_THRESHOLD = 15;
const THREAD_SELECTION_SCROLL_EDGE = 64;
const THREAD_SELECTION_MAX_SCROLL_SPEED = 18;

export const hasThreadSelectionDragStarted = (
  start: ThreadSelectionDragPoint,
  current: ThreadSelectionDragPoint
): boolean =>
  Math.hypot(current.x - start.x, current.y - start.y) >=
  THREAD_SELECTION_DRAG_THRESHOLD;

export const getThreadSelectionAutoScrollDelta = (
  pointerY: number,
  viewportStart: number,
  viewportEnd: number
): number => {
  const topDistance = viewportStart + THREAD_SELECTION_SCROLL_EDGE - pointerY;

  if (topDistance > 0) {
    return -Math.ceil(
      THREAD_SELECTION_MAX_SCROLL_SPEED *
        Math.min(1, topDistance / THREAD_SELECTION_SCROLL_EDGE)
    );
  }

  const bottomDistance =
    pointerY - (viewportEnd - THREAD_SELECTION_SCROLL_EDGE);

  return bottomDistance > 0
    ? Math.ceil(
        THREAD_SELECTION_MAX_SCROLL_SPEED *
          Math.min(1, bottomDistance / THREAD_SELECTION_SCROLL_EDGE)
      )
    : 0;
};

export const getThreadSelectionKey = (
  thread: Pick<GmailThreadSummary, "accountId" | "threadId">
): string => `${thread.accountId}:${thread.threadId}`;

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

export interface ThreadSelectionRangeChange {
  readonly checked: boolean;
  readonly threadKey: string;
}

export const getThreadSelectionRangeChanges = (
  threadKeys: readonly string[],
  initiallyCheckedThreadIds: ReadonlySet<string>,
  anchorIndex: number,
  previousIndex: number,
  nextIndex: number,
  checked: boolean
): readonly ThreadSelectionRangeChange[] => {
  const previousStart = Math.min(anchorIndex, previousIndex);
  const previousEnd = Math.max(anchorIndex, previousIndex);
  const nextStart = Math.min(anchorIndex, nextIndex);
  const nextEnd = Math.max(anchorIndex, nextIndex);
  const changes: ThreadSelectionRangeChange[] = [];

  for (
    let index = Math.min(previousIndex, nextIndex);
    index <= Math.max(previousIndex, nextIndex);
    index += 1
  ) {
    const wasInRange = index >= previousStart && index <= previousEnd;
    const isInRange = index >= nextStart && index <= nextEnd;

    if (wasInRange === isInRange) {
      continue;
    }

    const threadKey = threadKeys[index];

    if (threadKey !== undefined) {
      changes.push({
        checked: isInRange ? checked : initiallyCheckedThreadIds.has(threadKey),
        threadKey,
      });
    }
  }

  return changes;
};

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

export const getNextThreadSelectionIndex = (
  threadKeys: readonly string[],
  selectedThreadKey: string | null,
  direction: ThreadSelectionDirection
): number | null => {
  if (threadKeys.length === 0) {
    return null;
  }

  const selectedIndex =
    selectedThreadKey === null ? -1 : threadKeys.indexOf(selectedThreadKey);

  if (selectedIndex === -1) {
    return direction === 1 ? 0 : threadKeys.length - 1;
  }

  return Math.max(
    0,
    Math.min(threadKeys.length - 1, selectedIndex + direction)
  );
};
