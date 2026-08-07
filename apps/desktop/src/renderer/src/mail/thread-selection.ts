import type { GmailThreadSummary } from "@/shared/ipc/mail";

export type ThreadSelectionDirection = -1 | 1;

export interface ThreadSelection {
  accountId: string;
  threadId: string;
}

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
