import { useState } from "react";

import { Button } from "@/components/ui/button";

import appIcon from "../../../../../build/icon.png";
import googleLogo from "../../assets/google.svg";
import { GoogleOAuthSetupDialog } from "./google-oauth-setup";

interface LoginScreenProps {
  hasGoogleSetup: boolean;
  isSettingUp: boolean;
  isStarting: boolean;
  onLogin: () => void;
  onSetup: () => Promise<boolean>;
}

const LoginScreen = ({
  hasGoogleSetup,
  isSettingUp,
  isStarting,
  onLogin,
  onSetup,
}: LoginScreenProps) => {
  const [isSetupOpen, setIsSetupOpen] = useState(false);

  return (
    <main className="bg-background fixed inset-0 h-svh overflow-y-auto p-6 [-webkit-app-region:drag]">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center py-8">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <img
            alt=""
            className="size-10 rounded-xl"
            draggable={false}
            src={appIcon}
          />
          <h1 className="text-foreground text-xl font-semibold tracking-tight">
            Kisa
          </h1>
        </div>

        <section className="[-webkit-app-region:no-drag]">
          <header className="mb-5 text-center">
            <h2 className="font-heading text-base font-medium">
              Connect Gmail
            </h2>
            <p className="text-muted-foreground mt-1 text-xs/relaxed">
              Set up your personal Google client once, then sign in to Gmail.
            </p>
          </header>

          <div className="space-y-2">
            <Button
              className="h-10 w-full"
              disabled={isSettingUp || isStarting}
              onClick={() => setIsSetupOpen(true)}
              type="button"
              variant="outline"
            >
              Setup Google
            </Button>
            <Button
              className="h-10 w-full gap-2.5"
              disabled={!hasGoogleSetup || isSettingUp || isStarting}
              onClick={onLogin}
              size="lg"
              type="button"
            >
              <img
                alt=""
                aria-hidden="true"
                className="size-4"
                src={googleLogo}
              />
              {isStarting ? "Opening Google..." : "Login with Google"}
            </Button>
          </div>
        </section>
      </div>
      <GoogleOAuthSetupDialog
        isUploading={isSettingUp}
        onOpenChange={setIsSetupOpen}
        onUpload={onSetup}
        open={isSetupOpen}
      />
    </main>
  );
};

export default LoginScreen;
