import {
  createRootRoute,
  Navigate,
  Outlet,
  useRouteContext,
  useRouterState,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import AccountGate from "@/components/accounts/account-gate";
import Titlebar from "@/components/shell/titlebar";
import StartupSplash from "@/components/startup/startup-splash";
import { resolveInitialAuthGateState } from "@/startup/auth-gate";

export const Route = createRootRoute({
  beforeLoad: async () => ({
    authGateState: await resolveInitialAuthGateState(),
  }),
  component: RootLayout,
  errorComponent: StartupError,
  notFoundComponent: () => <Navigate replace to="/" />,
  pendingComponent: StartupPending,
});

function RootLayout() {
  const { authGateState } = useRouteContext({ from: "__root__" });
  const isThreadWindow = useRouterState({
    select: ({ location }) => location.pathname.startsWith("/thread/"),
  });

  return (
    <AccountGate initialState={authGateState}>
      <div className="app-content flex h-svh flex-col scroll-smooth antialiased">
        {isThreadWindow ? (
          <header
            aria-hidden="true"
            className="app-titlebar border-border/70 bg-background fixed inset-x-0 top-0 z-30 border-b"
          />
        ) : (
          <Titlebar />
        )}
        <main className="scroll-fade-y flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </AccountGate>
  );
}

function StartupPending() {
  return <StartupSplash />;
}

function StartupError({ error, reset }: ErrorComponentProps) {
  return (
    <StartupSplash
      errorMessage={
        error instanceof Error ? error.message : "Could not start the app"
      }
      onRetry={reset}
    />
  );
}
