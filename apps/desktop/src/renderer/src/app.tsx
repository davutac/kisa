import { RouterProvider } from "@tanstack/react-router";
import { AnimatePresence, domMax, LazyMotion } from "motion/react";

import type { AppRouter } from "@/router";

import AnimationsProvider from "./components/animations-provider";
import AppClosingOverlay from "./components/shell/app-closing-overlay";
import Providers from "./providers";

const App = ({ router }: { router: AppRouter }) => (
  <Providers>
    <AnimationsProvider>
      <LazyMotion features={domMax}>
        <AnimatePresence initial={false}>
          <RouterProvider router={router} />
        </AnimatePresence>
      </LazyMotion>
      <AppClosingOverlay />
    </AnimationsProvider>
  </Providers>
);

export default App;
