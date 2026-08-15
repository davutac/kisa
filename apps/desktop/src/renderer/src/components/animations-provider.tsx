import { MotionConfig } from "motion/react";
import { useLayoutEffect } from "react";
import type { ReactNode } from "react";

import { applyAnimationsPreference } from "@/lib/motion";
import { useAnimationsEnabled } from "@/state/general-settings";

const AnimationsProvider = ({ children }: { children: ReactNode }) => {
  const animationsEnabled = useAnimationsEnabled();

  useLayoutEffect(() => {
    applyAnimationsPreference(animationsEnabled);
  }, [animationsEnabled]);

  return (
    <MotionConfig reducedMotion={animationsEnabled ? "never" : "always"}>
      {children}
    </MotionConfig>
  );
};

export default AnimationsProvider;
