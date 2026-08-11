import { LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
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
      setIsConfirmOpen(false);
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
        <AlertDialog onOpenChange={setIsConfirmOpen} open={isConfirmOpen}>
          <AlertDialogTrigger
            render={
              <Button aria-labelledby={titleId} type="button" variant="outline">
                Disconnect
              </Button>
            }
          />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogMedia>
                <TriangleAlertIcon aria-hidden="true" />
              </AlertDialogMedia>
              <AlertDialogTitle>Disconnect {account.email}?</AlertDialogTitle>
              <AlertDialogDescription>
                This revokes access to the account and deletes everything stored
                for it on this device: saved sign-in, downloaded mail, labels,
                settings, and sync state. Nothing is deleted from Gmail, and you
                can connect the account again at any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDisconnecting}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={isDisconnecting}
                onClick={() => {
                  void handleDisconnect();
                }}
                type="button"
                variant="destructive"
              >
                {isDisconnecting ? (
                  <LoaderCircleIcon className="animate-spin" />
                ) : null}
                <span>Disconnect</span>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountDisconnectRow;
