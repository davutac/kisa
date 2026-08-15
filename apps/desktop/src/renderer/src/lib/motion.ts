import { useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";

import { useAnimationsEnabled } from "@/state/general-settings";

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

interface AnimationsDocumentElement {
  classList: Pick<DOMTokenList, "toggle">;
}

export const applyAnimationsPreference = (
  animationsEnabled: boolean,
  documentElement: AnimationsDocumentElement = document.documentElement
): void => {
  documentElement.classList.toggle("reduce-animations", !animationsEnabled);
};

/**
 * Whether interface motion should be suppressed: either the operating system
 * asks for reduced motion or the user disabled animations in settings.
 */
export const shouldReduceMotion = (
  animationsEnabled: boolean,
  prefersReducedMotion: boolean
): boolean => !animationsEnabled || prefersReducedMotion;

export const useShouldReduceMotion = (): boolean =>
  shouldReduceMotion(useAnimationsEnabled(), useReducedMotion() === true);
