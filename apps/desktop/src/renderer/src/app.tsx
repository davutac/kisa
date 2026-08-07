import { RouterProvider } from "@tanstack/react-router";
import { AnimatePresence, domMax, LazyMotion } from "motion/react";

import type { AppRouter } from "@/router";

import Providers from "./providers";

const App = ({ router }: { router: AppRouter }) => (
  <Providers>
    <LazyMotion features={domMax}>
      <AnimatePresence initial={false}>
        <RouterProvider router={router} />
      </AnimatePresence>
    </LazyMotion>
  </Providers>
);

export default App;
