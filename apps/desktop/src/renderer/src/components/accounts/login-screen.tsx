import { Button } from "@/components/ui/button";

import appIcon from "../../../../../build/icon.png";
import { openAccountSetup } from "./open-account-setup";

const LoginScreen = () => (
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
            Connect your mail
          </h2>
          <p className="text-muted-foreground mt-1 text-xs/relaxed">
            Gmail, iCloud and other accounts sign in with an app password.
          </p>
        </header>

        <Button
          className="h-10 w-full"
          onClick={() => {
            void openAccountSetup();
          }}
          size="lg"
          type="button"
        >
          Add account
        </Button>
      </section>
    </div>
  </main>
);

export default LoginScreen;
