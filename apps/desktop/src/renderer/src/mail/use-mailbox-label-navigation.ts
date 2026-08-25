import type { RefObject } from "react";
import { useRef } from "react";

import { useAppCommand } from "@/hotkeys";

const RAPID_LABEL_MOVE_INTERVAL_MS = 150;
const LABEL_SELECTOR = "[data-mailbox-label]";

interface MailboxLabelNavigation {
  readonly labelScrollRef: RefObject<HTMLDivElement | null>;
  readonly takeFocusAnimation: () => boolean;
}

export const blurFocusedMailboxLabel = (): void => {
  const { activeElement } = document;

  if (
    activeElement instanceof HTMLButtonElement &&
    Object.hasOwn(activeElement.dataset, "mailboxLabel")
  ) {
    activeElement.blur();
  }
};

export const centerMailboxLabel = (
  label: HTMLButtonElement,
  behavior: ScrollBehavior
): void => {
  label.scrollIntoView({ behavior, block: "nearest", inline: "center" });
};

const getVisibleLabelIndex = (
  labels: readonly HTMLButtonElement[],
  viewport: DOMRect,
  direction: -1 | 1
): number | null => {
  let match: number | null = null;

  for (const [index, label] of labels.entries()) {
    const bounds = label.getBoundingClientRect();
    const midpoint = (bounds.left + bounds.right) / 2;

    if (midpoint < viewport.left || midpoint > viewport.right) {
      continue;
    }

    if (match === null || (direction === 1 ? index < match : index > match)) {
      match = index;
    }
  }

  return match;
};

export const useMailboxLabelNavigation = ({
  enabled,
  shouldReduceMotion,
}: {
  readonly enabled: boolean;
  readonly shouldReduceMotion: boolean;
}): MailboxLabelNavigation => {
  const labelScrollRef = useRef<HTMLDivElement>(null);
  const lastLabelMoveAtRef = useRef<number | null>(null);
  const animateNextFocusRef = useRef(true);

  const takeFocusAnimation = (): boolean => {
    const animate = animateNextFocusRef.current;
    animateNextFocusRef.current = true;
    return animate;
  };

  const moveLabelFocus = (direction: -1 | 1): void => {
    const labelScroll = labelScrollRef.current;
    if (labelScroll === null) {
      return;
    }

    const labels = [
      ...labelScroll.querySelectorAll<HTMLButtonElement>(LABEL_SELECTOR),
    ];
    if (labels.length === 0) {
      return;
    }

    const { activeElement } = document;
    const currentIndex =
      activeElement instanceof HTMLButtonElement
        ? labels.indexOf(activeElement)
        : -1;
    const edgeIndex = direction === 1 ? 0 : labels.length - 1;
    const nextIndex =
      currentIndex === -1
        ? (getVisibleLabelIndex(
            labels,
            labelScroll.getBoundingClientRect(),
            direction
          ) ?? edgeIndex)
        : Math.max(0, Math.min(labels.length - 1, currentIndex + direction));

    const nextLabel = labels[nextIndex];
    if (nextLabel === undefined || nextIndex === currentIndex) {
      return;
    }

    const now = performance.now();
    const lastLabelMoveAt = lastLabelMoveAtRef.current;
    const isRapidLabelMove =
      lastLabelMoveAt !== null &&
      now - lastLabelMoveAt < RAPID_LABEL_MOVE_INTERVAL_MS;
    lastLabelMoveAtRef.current = now;
    animateNextFocusRef.current = !isRapidLabelMove;

    // Focus normally scrolls a button into the nearest visible position before
    // our centered scroll runs. Prevent that first jump so keyboard repeat has
    // one scroll owner, matching the thread-list navigation model.
    nextLabel.focus({ preventScroll: true });
    centerMailboxLabel(
      nextLabel,
      shouldReduceMotion || isRapidLabelMove ? "auto" : "smooth"
    );
  };

  useAppCommand(
    "mailbox.nextLabel",
    () => {
      moveLabelFocus(1);
    },
    { enabled }
  );
  useAppCommand(
    "mailbox.previousLabel",
    () => {
      moveLabelFocus(-1);
    },
    { enabled }
  );

  return { labelScrollRef, takeFocusAnimation };
};
