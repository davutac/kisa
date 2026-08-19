import { toast } from "sonner";

import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { SettingsApi } from "@/platform/desktop";
import type { EmailSignatureBody } from "@/shared/email-signature";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useAccountSettings } from "@/state/account-settings";

import EmailSignatureDialog from "./email-signature-dialog";

interface SettingsAccountSignatureRowProps {
  account: GoogleAccount;
  settingsApi: SettingsApi;
}

const SettingsAccountSignatureRow = ({
  account,
  settingsApi,
}: SettingsAccountSignatureRowProps) => {
  const { emailSignature } = useAccountSettings(account.email);

  const save = async (signature: EmailSignatureBody): Promise<boolean> => {
    try {
      const reply = await settingsApi.updateAccountSettings({
        accountId: account.email,
        emailSignature: signature,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return false;
      }

      toast.success("Signature saved");
      return true;
    } catch {
      toast.error("Could not save the signature", {
        description: "Please try again.",
      });
      return false;
    }
  };

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle>Email signature</SettingsRowTitle>
        <SettingsRowDescription>
          Added to new messages, replies, and forwards from this account.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <EmailSignatureDialog
          onSave={save}
          triggerLabel={`Edit email signature for ${account.email}`}
          value={emailSignature}
        />
      </SettingsRowActions>
    </SettingsRow>
  );
};

export default SettingsAccountSignatureRow;
