import { useState } from "react";
import { toast } from "sonner";

import { GoogleOAuthSetupDialog } from "@/components/accounts/google-oauth-setup";
import { useGoogleOAuthSetup } from "@/components/accounts/use-google-oauth-setup";
import { Button } from "@/components/ui/button";
import {
  SettingsRow,
  SettingsRowActions,
  SettingsRowContent,
  SettingsRowDescription,
  SettingsRowTitle,
} from "@/components/ui/settings";
import type { AuthApi } from "@/platform/desktop";

const SettingsGoogleOAuthRow = ({
  authApi,
}: {
  authApi: Pick<AuthApi, "setupGoogleOAuthClient">;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { isSettingUp, setupGoogle } = useGoogleOAuthSetup(authApi, () => {
    toast.success("Google setup saved", {
      description: "Use Add account to connect or reconnect an account.",
    });
  });

  return (
    <SettingsRow>
      <SettingsRowContent>
        <SettingsRowTitle>Google connection</SettingsRowTitle>
        <SettingsRowDescription id="google-connection-description">
          Set up or replace your Google credentials. Existing accounts keep
          their saved sign-in until you reconnect them.
        </SettingsRowDescription>
      </SettingsRowContent>
      <SettingsRowActions>
        <Button
          aria-describedby="google-connection-description"
          disabled={isSettingUp}
          onClick={() => setIsOpen(true)}
          type="button"
          variant="secondary"
        >
          Set up Google
        </Button>
      </SettingsRowActions>
      <GoogleOAuthSetupDialog
        isUploading={isSettingUp}
        onOpenChange={setIsOpen}
        onUpload={setupGoogle}
        open={isOpen}
      />
    </SettingsRow>
  );
};

export default SettingsGoogleOAuthRow;
