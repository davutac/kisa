import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";

import { ConfirmMessage, useConfirm } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import { toast } from "@/components/ui/toast";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import type { AccountsApi } from "@/platform/desktop";
import type { Account } from "@/shared/ipc/accounts";

import { toAccountSettingsPage } from "./settings-pages";
import { toSettingsTarget } from "./settings-search";
import { SearchableSettingsRow } from "./settings-search-target";

interface SettingsAccountDisconnectRowProps {
  account: Account;
  accountsApi: AccountsApi;
}

const SettingsAccountDisconnectRow = ({
  account,
  accountsApi,
}: SettingsAccountDisconnectRowProps) => {
  const confirm = useConfirm();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const titleId = `account-${account.email}-disconnect-title`;

  const handleDisconnect = async (): Promise<void> => {
    setIsDisconnecting(true);
    await runWithCleanup(
      async () => {
        try {
          const reply = await accountsApi.disconnectAccount({
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
        }
      },
      () => {
        setIsDisconnecting(false);
      }
    );
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
          Kisa will sign out, and everything stored for this account on this
          device will be deleted: saved sign-in, downloaded mail, labels,
          settings, sync state, scheduled emails, and unresolved delivery
          evidence. Unsent scheduled emails will no longer be delivered. A
          scheduled email with an unknown outcome may already have reached the
          mail server, so check Sent before disconnecting. Nothing will be
          deleted from the mail server, and you can connect the account again at
          any time. The app password keeps working until you remove it with your
          mail provider.
        </ConfirmMessage>
      ),
      title: "Disconnect account?",
    });

    if (confirmed) {
      await handleDisconnect();
    }
  };

  return (
    <SearchableSettingsRow
      target={toSettingsTarget(
        toAccountSettingsPage(account.email),
        "disconnect"
      )}
    >
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>Disconnect</SettingsRowTitle>
        <SettingsRowDescription>
          Sign out and delete everything stored for this account on this device.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
          aria-label={`Disconnect ${account.email}`}
          disabled={isDisconnecting}
          onClick={() => {
            void requestDisconnect();
          }}
          type="button"
          variant="destructive"
        >
          {isDisconnecting ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          Disconnect
        </Button>
      </SettingsRowActions>
    </SearchableSettingsRow>
  );
};

export default SettingsAccountDisconnectRow;
