import { createRouter } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

export const getRouter = (history: RouterHistory) =>
  createRouter({ history, routeTree, scrollRestoration: true });

export type AppRouter = ReturnType<typeof getRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
