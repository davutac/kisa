import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmMessage, useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { AuthApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";

interface SettingsAccountDisconnectRowProps {
  account: GoogleAccount;
  authApi: AuthApi;
}

const SettingsAccountDisconnectRow = ({
  account,
  authApi,
}: SettingsAccountDisconnectRowProps) => {
  const confirm = useConfirm();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const titleId = `account-${account.email}-disconnect-title`;

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    try {
      const reply = await authApi.disconnectGoogleAccount({
        email: account.email,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      toast.success(`Disconnected ${account.email}`, {
        description: "Its downloaded mail was deleted from this device.",
      });
    } catch {
      toast.error("Could not disconnect the account", {
        description: "Please try again.",
      });
    } finally {
      setIsDisconnecting(false);
    }
  };

  const requestDisconnect = async (): Promise<void> => {
    if (isDisconnecting) {
      return;
    }

    const confirmed = await confirm({
      confirmLabel: "Disconnect",
      confirmVariant: "destructive",
      description: (
        <ConfirmMessage subject={account.email}>
          Access will be revoked and everything stored for this account on this
          device will be deleted: saved sign-in, downloaded mail, labels,
          settings, sync state, scheduled emails, and unresolved delivery
          evidence. Unsent scheduled emails will no longer be delivered. A
          scheduled email with an unknown outcome may already have reached
          Gmail, so check Sent before disconnecting. Nothing will be deleted
          from Gmail, and you can connect the account again at any time.
        </ConfirmMessage>
      ),
      title: "Disconnect account?",
    });

    if (confirmed) {
      await handleDisconnect();
    }
  };

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>Disconnect</SettingsRowTitle>
        <SettingsRowDescription>
          Revoke access and delete everything stored for this account on this
          device.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
          aria-labelledby={titleId}
          disabled={isDisconnecting}
          onClick={() => {
            void requestDisconnect();
          }}
          type="button"
          variant="secondary"
        >
          {isDisconnecting ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          Disconnect
        </Button>
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountDisconnectRow;
