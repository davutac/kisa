import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";

import { NewMessagePage } from "@/components/mail/new-message";
import { useToggleWorkspace } from "@/components/shell/shell-workspace";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useHotkeyLayer } from "@/hotkeys";
import { getMailApi } from "@/platform/desktop";
import { useAccounts } from "@/state/accounts";
import { useSelectedAccountId } from "@/state/mailbox";

export const Route = createFileRoute("/compose")({
  component: ComposeRoute,
});

/**
 * A new email, a page like Settings and Templates, so New email reads as
 * pressed while it is open and the sidebar shows no other place as current.
 * It starts from the account scope it was opened from, and closing it
 * returns to the view it was opened over.
 */
function ComposeRoute() {
  const accounts = useAccounts();
  const selectedAccountId = useSelectedAccountId();
  const initialAccountId = useInstanceValue(() => selectedAccountId);
  const toggleWorkspace = useToggleWorkspace();
  const navigate = useNavigate();
  const canCompose = getMailApi() !== undefined && accounts.length > 0;

  useHotkeyLayer("composer", canCompose);

  if (!canCompose) {
    return <Navigate replace to="/" />;
  }

  return (
    <NewMessagePage
      accounts={accounts}
      initialAccountId={initialAccountId}
      onClose={() => {
        if (toggleWorkspace === null) {
          void navigate({ to: "/" });
          return;
        }
        toggleWorkspace("/compose");
      }}
    />
  );
}
