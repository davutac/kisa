import { RouterProvider } from "@tanstack/react-router";
import {
  AnimatePresence,
  domMax,
  LazyMotion,
  MotionConfig,
} from "motion/react";
import { useLayoutEffect } from "react";

import type { AppRouter } from "@/router";

import AppClosingOverlay from "./components/shell/app-closing-overlay";
import Providers from "./providers";
import { useAnimationsEnabled } from "./state/general-settings";

const App = ({ router }: { router: AppRouter }) => {
  const animationsEnabled = useAnimationsEnabled();

  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      "reduce-animations",
      !animationsEnabled
    );
  }, [animationsEnabled]);

  return (
    <Providers>
      <LazyMotion features={domMax}>
        <MotionConfig reducedMotion={animationsEnabled ? "never" : "always"}>
          <AnimatePresence initial={false}>
            <RouterProvider router={router} />
          </AnimatePresence>
        </MotionConfig>
      </LazyMotion>
      <AppClosingOverlay />
    </Providers>
  );
};

export default App;
