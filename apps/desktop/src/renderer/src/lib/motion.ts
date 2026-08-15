import type { Transition } from "motion/react";

/**
 * One easing curve for the whole app: everything eases in and out, nothing
 * springs or overshoots. Durations still vary per animation, the curve does
 * not.
 */
export const MOTION_EASE = "easeInOut" as const;

/** Reduced motion: land on the end state without travelling to it. */
export const NO_MOTION: Transition = { duration: 0 };

export const easeInOut = (duration: number): Transition => ({
  duration,
  ease: MOTION_EASE,
});

interface AnimationClassTarget {
  classList: Pick<DOMTokenList, "toggle">;
}

export const applyAnimationsClass = (
  target: AnimationClassTarget,
  animationsEnabled: boolean
): void => {
  target.classList.toggle("reduce-animations", !animationsEnabled);
};
