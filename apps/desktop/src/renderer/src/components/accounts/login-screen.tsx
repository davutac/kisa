import { Button } from "@/components/ui/button";

interface LoginScreenProps {
  isStarting: boolean;
  onLogin: () => void;
}

const LoginScreen = ({ isStarting, onLogin }: LoginScreenProps) => (
  <main className="bg-background fixed inset-0 flex h-svh items-center justify-center p-6 [-webkit-app-region:drag]">
    <Button
      className="[-webkit-app-region:no-drag]"
      disabled={isStarting}
      onClick={onLogin}
      size="lg"
    >
      Sign in with Google
    </Button>
  </main>
);

export default LoginScreen;
