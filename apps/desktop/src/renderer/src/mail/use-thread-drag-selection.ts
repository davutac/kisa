import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent, RefObject } from "react";

import {
  getThreadSelectionRangeChanges,
  getThreadSelectionAutoScrollDelta,
  hasThreadSelectionDragStarted,
} from "@/mail/thread-selection";

interface DragOrigin {
  readonly anchorThreadKey: string;
  readonly checked: boolean;
  readonly initiallyCheckedThreadIds: ReadonlySet<string>;
  readonly pointerId: number;
}

interface PendingDrag extends DragOrigin {
  readonly startX: number;
  readonly startY: number;
}

interface ActiveDrag extends DragOrigin {
  currentThreadKey: string;
}

interface UseThreadDragSelectionOptions {
  readonly checkedThreadIds: ReadonlySet<string>;
  readonly checkThread: (threadKey: string, checked: boolean) => void;
  readonly scrollElementRef: RefObject<HTMLElement | null>;
  readonly selectThread: (threadKey: string) => void;
  readonly threadKeys: readonly string[];
}

interface PointerPosition {
  readonly x: number;
  readonly y: number;
}

const THREAD_SELECTION_KEY_ATTRIBUTE = "data-thread-selection-key";
const POINTER_EDGE_OVERSHOOT = 32;

export const useThreadDragSelection = ({
  checkedThreadIds,
  checkThread,
  scrollElementRef,
  selectThread,
  threadKeys,
}: UseThreadDragSelectionOptions) => {
  const pendingDragRef = useRef<PendingDrag | null>(null);
  const activeDragRef = useRef<ActiveDrag | null>(null);
  const pointerPositionRef = useRef<PointerPosition | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const suppressOpenRef = useRef(false);
  const threadKeysRef = useRef(threadKeys);

  useEffect(() => {
    threadKeysRef.current = threadKeys;
  }, [threadKeys]);

  const applyActiveRange = useCallback(
    (threadKey: string): void => {
      const activeDrag = activeDragRef.current;

      if (activeDrag === null || activeDrag.currentThreadKey === threadKey) {
        return;
      }

      const currentThreadKeys = threadKeysRef.current;
      const anchorIndex = currentThreadKeys.indexOf(activeDrag.anchorThreadKey);
      const previousIndex = currentThreadKeys.indexOf(
        activeDrag.currentThreadKey
      );
      const nextIndex = currentThreadKeys.indexOf(threadKey);

      if (anchorIndex === -1 || previousIndex === -1 || nextIndex === -1) {
        return;
      }

      for (const change of getThreadSelectionRangeChanges(
        currentThreadKeys,
        activeDrag.initiallyCheckedThreadIds,
        anchorIndex,
        previousIndex,
        nextIndex,
        activeDrag.checked
      )) {
        checkThread(change.threadKey, change.checked);
      }

      activeDrag.currentThreadKey = threadKey;
      selectThread(threadKey);
    },
    [checkThread, selectThread]
  );

  useEffect(() => {
    const selectAtPoint = (
      point: PointerPosition,
      scrollElement: HTMLElement
    ): void => {
      if (activeDragRef.current === null) {
        return;
      }

      const bounds = scrollElement.getBoundingClientRect();
      const x = Math.max(bounds.left + 1, Math.min(bounds.right - 1, point.x));
      const y = Math.max(bounds.top + 1, Math.min(bounds.bottom - 1, point.y));
      let threadKey: string | undefined;

      for (const element of document.elementsFromPoint(x, y)) {
        const row = element.closest<HTMLElement>(
          `[${THREAD_SELECTION_KEY_ATTRIBUTE}]`
        );

        if (row !== null) {
          threadKey = row.dataset.threadSelectionKey;
          break;
        }
      }

      if (threadKey !== undefined) {
        applyActiveRange(threadKey);
      }
    };

    const scrollSelection = (): void => {
      animationFrameRef.current = null;
      const point = pointerPositionRef.current;
      const scrollElement = scrollElementRef.current;

      if (
        activeDragRef.current === null ||
        point === null ||
        scrollElement === null
      ) {
        return;
      }

      const bounds = scrollElement.getBoundingClientRect();
      const pointerIsNearViewport =
        point.x >= bounds.left &&
        point.x <= bounds.right &&
        point.y >= bounds.top - POINTER_EDGE_OVERSHOOT &&
        point.y <= bounds.bottom + POINTER_EDGE_OVERSHOOT;

      if (!pointerIsNearViewport) {
        return;
      }

      const scrollDelta = getThreadSelectionAutoScrollDelta(
        point.y,
        bounds.top,
        bounds.bottom
      );

      if (scrollDelta === 0) {
        return;
      }

      scrollElement.scrollTop += scrollDelta;
      selectAtPoint(point, scrollElement);
      animationFrameRef.current = requestAnimationFrame(scrollSelection);
    };

    const beginAutoScroll = (): void => {
      if (animationFrameRef.current === null) {
        animationFrameRef.current = requestAnimationFrame(scrollSelection);
      }
    };

    const finishDrag = (): void => {
      pendingDragRef.current = null;
      activeDragRef.current = null;
      pointerPositionRef.current = null;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    const startDrag = (event: globalThis.PointerEvent): void => {
      const pending = pendingDragRef.current;

      if (
        activeDragRef.current !== null &&
        event.pointerId === activeDragRef.current.pointerId
      ) {
        event.preventDefault();
        pointerPositionRef.current = { x: event.clientX, y: event.clientY };
        const scrollElement = scrollElementRef.current;

        if (scrollElement !== null) {
          selectAtPoint(pointerPositionRef.current, scrollElement);
        }

        beginAutoScroll();
        return;
      }

      if (
        pending === null ||
        event.pointerId !== pending.pointerId ||
        !hasThreadSelectionDragStarted(
          { x: pending.startX, y: pending.startY },
          { x: event.clientX, y: event.clientY }
        )
      ) {
        return;
      }

      event.preventDefault();
      pendingDragRef.current = null;
      activeDragRef.current = {
        anchorThreadKey: pending.anchorThreadKey,
        checked: pending.checked,
        currentThreadKey: pending.anchorThreadKey,
        initiallyCheckedThreadIds: pending.initiallyCheckedThreadIds,
        pointerId: event.pointerId,
      };
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      suppressOpenRef.current = true;
      checkThread(pending.anchorThreadKey, pending.checked);
      selectThread(pending.anchorThreadKey);
      const scrollElement = scrollElementRef.current;

      if (scrollElement !== null) {
        selectAtPoint(pointerPositionRef.current, scrollElement);
      }

      beginAutoScroll();
    };

    document.addEventListener("pointermove", startDrag, true);
    document.addEventListener("pointerup", finishDrag);
    document.addEventListener("pointercancel", finishDrag);
    window.addEventListener("blur", finishDrag);

    return () => {
      finishDrag();
      document.removeEventListener("pointermove", startDrag, true);
      document.removeEventListener("pointerup", finishDrag);
      document.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("blur", finishDrag);
    };
  }, [applyActiveRange, checkThread, scrollElementRef, selectThread]);

  const onRowPointerDown = useCallback(
    (threadKey: string, event: PointerEvent<HTMLButtonElement>): void => {
      if (event.button !== 0) {
        return;
      }

      suppressOpenRef.current = false;
      activeDragRef.current = null;
      pendingDragRef.current = {
        anchorThreadKey: threadKey,
        checked: !checkedThreadIds.has(threadKey),
        initiallyCheckedThreadIds: new Set(checkedThreadIds),
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    [checkedThreadIds]
  );

  const onSelectionPointerDown = useCallback(
    (threadKey: string, event: PointerEvent<HTMLInputElement>): void => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const checked = !checkedThreadIds.has(threadKey);
      pendingDragRef.current = null;
      suppressOpenRef.current = false;
      activeDragRef.current = {
        anchorThreadKey: threadKey,
        checked,
        currentThreadKey: threadKey,
        initiallyCheckedThreadIds: new Set(checkedThreadIds),
        pointerId: event.pointerId,
      };
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };
      checkThread(threadKey, checked);
      selectThread(threadKey);
    },
    [checkedThreadIds, checkThread, selectThread]
  );

  const onSelectionPointerEnter = useCallback(
    (threadKey: string): void => {
      applyActiveRange(threadKey);
    },
    [applyActiveRange]
  );

  const consumeSuppressedOpen = useCallback((clickDetail: number): boolean => {
    if (!suppressOpenRef.current || clickDetail === 0) {
      return false;
    }

    suppressOpenRef.current = false;
    return true;
  }, []);

  return {
    consumeSuppressedOpen,
    onRowPointerDown,
    onSelectionPointerDown,
    onSelectionPointerEnter,
  };
};
