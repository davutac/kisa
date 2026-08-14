import { Button } from "@/components/ui/button";

import appIcon from "../../../../../build/icon.png";
import googleLogo from "../../assets/google.svg";

interface LoginScreenProps {
  isStarting: boolean;
  onLogin: () => void;
}

const LoginScreen = ({ isStarting, onLogin }: LoginScreenProps) => (
  <main className="bg-background fixed inset-0 flex h-svh items-center justify-center p-6 [-webkit-app-region:drag]">
    <div className="absolute top-8 left-1/2 flex -translate-x-1/2 items-center gap-2.5">
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

    <Button
      className="h-11 gap-3 rounded-lg px-5 text-sm [-webkit-app-region:no-drag] [&_img]:size-5"
      disabled={isStarting}
      onClick={onLogin}
      size="lg"
    >
      <img alt="" aria-hidden="true" src={googleLogo} />
      {isStarting ? "Opening Google…" : "Sign in with Google"}
    </Button>
  </main>
);

export default LoginScreen;
