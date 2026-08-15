import { MotionConfig } from "motion/react";
import { useLayoutEffect } from "react";
import type { ReactNode } from "react";

import { applyAnimationsClass } from "@/lib/motion";
import { useAnimationsEnabled } from "@/state/general-settings";

const AnimationsProvider = ({ children }: { children: ReactNode }) => {
  const animationsEnabled = useAnimationsEnabled();

  useLayoutEffect(() => {
    applyAnimationsClass(document.documentElement, animationsEnabled);
  }, [animationsEnabled]);

  return (
    <MotionConfig reducedMotion={animationsEnabled ? "user" : "always"}>
      {children}
    </MotionConfig>
  );
};

export default AnimationsProvider;
