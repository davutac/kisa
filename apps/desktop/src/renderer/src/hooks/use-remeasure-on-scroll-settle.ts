import type { Virtualizer } from "@tanstack/react-virtual";
import { useRef } from "react";

/**
 * An `onChange` handler for virtualizers whose rows use `measureElement` and
 * are reached through smooth `scrollToIndex`. A smooth scroll drops
 * measurements for rows outside its target window and never retries them, so
 * a row taller than the estimate would stay at the estimate and the next row
 * would overlap it. Re-measuring the rendered rows once scrolling settles
 * restores their real sizes.
 *
 * Callers keep calling `useVirtualizer` directly: React Compiler recognizes it
 * as incompatible and skips memoizing the component, which a wrapper hook
 * would hide.
 */
export const useRemeasureOnScrollSettle = () => {
  const wasScrollingRef = useRef(false);

  return <TScrollElement extends Element, TItemElement extends Element>(
    instance: Virtualizer<TScrollElement, TItemElement>
  ): void => {
    const scrollSettled = wasScrollingRef.current && !instance.isScrolling;
    wasScrollingRef.current = instance.isScrolling;
    if (!scrollSettled) {
      return;
    }
    // Current virtual items rather than the whole element cache, which can
    // still hold exiting rows whose `data-index` points at another item.
    for (const item of instance.getVirtualItems()) {
      const element = instance.elementsCache.get(item.key);
      if (element !== undefined) {
        instance.measureElement(element);
      }
    }
  };
};
