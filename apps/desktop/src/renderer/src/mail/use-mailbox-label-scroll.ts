import { useEffect, useState } from "react";

import { blurFocusedMailboxLabel } from "@/mail/use-mailbox-label-navigation";

// Fractional device-pixel scroll offsets rarely land exactly on an edge.
const SCROLL_EDGE_TOLERANCE_PX = 1;
// Small hand movement during a click must still toggle the label.
const DRAG_THRESHOLD_PX = 6;
const PAGE_SCROLL_RATIO = 0.3;

export const getMailboxLabelScrollEdges = ({
  clientWidth,
  scrollLeft,
  scrollWidth,
}: Pick<HTMLElement, "clientWidth" | "scrollLeft" | "scrollWidth">) => ({
  canScrollBackward: scrollLeft > SCROLL_EDGE_TOLERANCE_PX,
  canScrollForward:
    scrollWidth - clientWidth - scrollLeft > SCROLL_EDGE_TOLERANCE_PX,
});

export const useMailboxLabelScroll = ({
  labelScroller,
  shouldReduceMotion,
}: {
  readonly labelScroller: HTMLDivElement | null;
  readonly shouldReduceMotion: boolean;
}) => {
  const [canScrollBackward, setCanScrollBackward] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  useEffect(() => {
    const scroller = labelScroller;
    if (scroller === null) {
      return;
    }

    const updateEdges = (): void => {
      const edges = getMailboxLabelScrollEdges(scroller);
      setCanScrollBackward(edges.canScrollBackward);
      setCanScrollForward(edges.canScrollForward);
    };

    let drag: {
      readonly pointerId: number;
      readonly startScrollLeft: number;
      readonly startX: number;
      isDragging: boolean;
    } | null = null;

    const endDrag = (event: PointerEvent): void => {
      if (drag?.pointerId !== event.pointerId) {
        return;
      }
      drag = null;
      delete scroller.dataset.dragging;
    };

    const onPointerDown = (event: PointerEvent): void => {
      drag =
        event.pointerType === "mouse" && event.button === 0
          ? {
              isDragging: false,
              pointerId: event.pointerId,
              startScrollLeft: scroller.scrollLeft,
              startX: event.clientX,
            }
          : null;
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (drag?.pointerId !== event.pointerId) {
        return;
      }
      // A release outside the scroller before capture never reaches us.
      if (event.buttons === 0) {
        endDrag(event);
        return;
      }

      const deltaX = event.clientX - drag.startX;
      if (!drag.isDragging) {
        if (Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
          return;
        }
        drag.isDragging = true;
        // Capture keeps the drag alive outside the strip and retargets the
        // release click to the scroller, so the label where the drag started
        // never toggles.
        scroller.setPointerCapture(event.pointerId);
        scroller.dataset.dragging = "";
        blurFocusedMailboxLabel();
      }
      scroller.scrollLeft = drag.startScrollLeft - deltaX;
    };

    // Observing the content too catches labels arriving or leaving.
    const resizeObserver = new ResizeObserver(updateEdges);
    resizeObserver.observe(scroller);
    for (const content of scroller.children) {
      resizeObserver.observe(content);
    }

    const listeners = new AbortController();
    const { signal } = listeners;
    scroller.addEventListener("scroll", updateEdges, { passive: true, signal });
    scroller.addEventListener("pointerdown", onPointerDown, { signal });
    scroller.addEventListener("pointermove", onPointerMove, { signal });
    scroller.addEventListener("pointerup", endDrag, { signal });
    scroller.addEventListener("lostpointercapture", endDrag, { signal });

    return () => {
      listeners.abort();
      resizeObserver.disconnect();
      delete scroller.dataset.dragging;
      setCanScrollBackward(false);
      setCanScrollForward(false);
    };
  }, [labelScroller]);

  const scrollLabels = (direction: -1 | 1): void => {
    labelScroller?.scrollBy({
      behavior: shouldReduceMotion ? "auto" : "smooth",
      left: direction * labelScroller.clientWidth * PAGE_SCROLL_RATIO,
    });
  };

  return { canScrollBackward, canScrollForward, scrollLabels };
};
