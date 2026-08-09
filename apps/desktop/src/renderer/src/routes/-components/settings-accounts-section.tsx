import {
  LoaderCircleIcon,
  TriangleAlertIcon,
  UserRoundIcon,
} from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRows,
  SettingsRowTitle,
  SettingsSection,
  SettingsSectionDescription,
  SettingsSectionHeader,
  SettingsSectionTitle,
} from "@/components/ui/settings";
import { Switch } from "@/components/ui/switch";
import type { AuthApi, MailApi, SettingsApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useAccountSettings } from "@/state/account-settings";
import { useGoogleAccounts } from "@/state/google-accounts";

import SettingsAccountLabelsRow from "./settings-account-labels-row";

interface SettingsAccountSystemLabelsRowProps {
  account: GoogleAccount;
  settingsApi: SettingsApi;
}

const SettingsAccountSystemLabelsRow = ({
  account,
  settingsApi,
}: SettingsAccountSystemLabelsRowProps) => {
  const { showSystemLabels } = useAccountSettings(account.email);
  const [isSaving, setIsSaving] = useState(false);
  const titleId = `account-${account.email}-system-labels-title`;

  const handleChange = async (checked: boolean): Promise<void> => {
    setIsSaving(true);

    try {
      const reply = await settingsApi.updateAccountSettings({
        accountId: account.email,
        showSystemLabels: checked,
      });

      if (!reply.ok) {
        toast.error(reply.error);
      }
    } catch {
      toast.error("Could not save the setting", {
        description: "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>Gmail system labels</SettingsRowTitle>
        <SettingsRowDescription>
          Show the labels Gmail assigns itself, such as Inbox, Important and the
          category labels, on threads from this account.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={titleId}
          checked={showSystemLabels}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

interface SettingsAccountNotificationsRowProps {
  account: GoogleAccount;
  settingsApi: SettingsApi;
}

const SettingsAccountNotificationsRow = ({
  account,
  settingsApi,
}: SettingsAccountNotificationsRowProps) => {
  const { notificationsEnabled } = useAccountSettings(account.email);
  const [isSaving, setIsSaving] = useState(false);
  const titleId = `account-${account.email}-notifications-title`;

  const handleChange = async (checked: boolean): Promise<void> => {
    setIsSaving(true);

    try {
      const reply = await settingsApi.updateAccountSettings({
        accountId: account.email,
        notificationsEnabled: checked,
      });

      if (!reply.ok) {
        toast.error(reply.error);
      }
    } catch {
      toast.error("Could not save the setting", {
        description: "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle id={titleId}>
          New email notifications
        </SettingsRowTitle>
        <SettingsRowDescription>
          Show a system notification when new unread mail arrives for this
          account.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Switch
          aria-labelledby={titleId}
          checked={notificationsEnabled}
          disabled={isSaving}
          onCheckedChange={(checked) => {
            void handleChange(checked);
          }}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

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

interface SettingsAccountSectionProps {
  account: GoogleAccount;
  authApi: AuthApi;
  mailApi?: MailApi;
  settingsApi?: SettingsApi;
}

const SettingsAccountSection = ({
  account,
  authApi,
  mailApi,
  settingsApi,
}: SettingsAccountSectionProps) => {
  const titleId = `account-${account.email}-title`;

  return (
    <SettingsSection aria-labelledby={titleId}>
      <SettingsSectionHeader>
        {/* The section title carries the row gutter itself, so the avatar takes
            it over once it sits in front of the title. */}
        <div className="flex min-w-0 items-center gap-3 pl-4 md:pl-5">
          <Avatar size="lg">
            <AvatarImage alt="" src={account.avatarUrl} />
            <AvatarFallback>
              <UserRoundIcon aria-hidden="true" className="size-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0">
            <SettingsSectionTitle
              className="truncate pl-0 leading-tight"
              id={titleId}
            >
              {account.displayName ?? account.email}
            </SettingsSectionTitle>
            {account.displayName === undefined ? null : (
              <SettingsSectionDescription className="truncate">
                {account.email}
              </SettingsSectionDescription>
            )}
          </div>
        </div>
      </SettingsSectionHeader>

      <SettingsRows>
        {settingsApi === undefined ? null : (
          <SettingsAccountNotificationsRow
            account={account}
            settingsApi={settingsApi}
          />
        )}
        {mailApi === undefined ? null : (
          <SettingsAccountLabelsRow
            accountId={account.email}
            mailApi={mailApi}
          />
        )}
        {settingsApi === undefined ? null : (
          <SettingsAccountSystemLabelsRow
            account={account}
            settingsApi={settingsApi}
          />
        )}
        <SettingsAccountDisconnectRow account={account} authApi={authApi} />
      </SettingsRows>
    </SettingsSection>
  );
};

interface SettingsAccountsSectionProps {
  authApi: AuthApi;
  mailApi?: MailApi;
  settingsApi?: SettingsApi;
}

const SettingsAccountsSection = ({
  authApi,
  mailApi,
  settingsApi,
}: SettingsAccountsSectionProps) => {
  const accounts = useGoogleAccounts();

  return accounts.map((account) => (
    <SettingsAccountSection
      account={account}
      authApi={authApi}
      key={account.email}
      mailApi={mailApi}
      settingsApi={settingsApi}
    />
  ));
};

export default SettingsAccountsSection;
