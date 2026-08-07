import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 768;

const getIsMobileSnapshot = (): boolean =>
  window.innerWidth < MOBILE_BREAKPOINT;

const getServerIsMobileSnapshot = (): boolean => false;

const subscribeToMobileBreakpoint = (
  onStoreChange: () => void
): (() => void) => {
  const mediaQuery = window.matchMedia(
    `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
  );

  mediaQuery.addEventListener("change", onStoreChange);
  return () => mediaQuery.removeEventListener("change", onStoreChange);
};

export const useIsMobile = (): boolean =>
  useSyncExternalStore(
    subscribeToMobileBreakpoint,
    getIsMobileSnapshot,
    getServerIsMobileSnapshot
  );
