import {
  createRootRoute,
  Navigate,
  Outlet,
  useRouteContext,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import AccountGate from "@/components/accounts/account-gate";
import Titlebar from "@/components/shell/titlebar";
import StartupSplash from "@/components/startup/startup-splash";
import { resolveInitialAuthGateState } from "@/startup/auth-gate";

const RootLayout = () => {
  const { authGateState } = useRouteContext({ from: "__root__" });

  return (
    <AccountGate initialState={authGateState}>
      <div className="app-content flex h-svh flex-col">
        <Titlebar />
        <main className="scroll-fade-y flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </AccountGate>
  );
};

const StartupPending = () => <StartupSplash />;

const StartupError = ({ error, reset }: ErrorComponentProps) => (
  <StartupSplash
    errorMessage={
      error instanceof Error ? error.message : "Could not start the app"
    }
    onRetry={reset}
  />
);

export const Route = createRootRoute({
  beforeLoad: async () => ({
    authGateState: await resolveInitialAuthGateState(),
  }),
  component: RootLayout,
  errorComponent: StartupError,
  notFoundComponent: () => <Navigate replace to="/" />,
  pendingComponent: StartupPending,
});
