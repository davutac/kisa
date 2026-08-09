import { RouterProvider } from "@tanstack/react-router";
import { AnimatePresence, domMax, LazyMotion } from "motion/react";

import type { AppRouter } from "@/router";

import AppClosingOverlay from "./components/shell/app-closing-overlay";
import Providers from "./providers";

const App = ({ router }: { router: AppRouter }) => (
  <Providers>
    <LazyMotion features={domMax}>
      <AnimatePresence initial={false}>
        <RouterProvider router={router} />
      </AnimatePresence>
    </LazyMotion>
    <AppClosingOverlay />
  </Providers>
);

export default App;
