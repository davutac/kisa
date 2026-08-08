import { CircleAlertIcon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { easeInOut } from "@/lib/motion";

interface StartupSplashProps {
  errorMessage?: string;
  onRetry?: () => void;
}

const getStatusLabel = (errorMessage: string | undefined): string => {
  if (errorMessage !== undefined) {
    return "Startup failed";
  }

  return "Starting";
};

const getStatusDescription = (errorMessage: string | undefined): string => {
  if (errorMessage !== undefined) {
    return errorMessage;
  }

  return "Getting things ready";
};

const StartupSplash = ({ errorMessage, onRetry }: StartupSplashProps) => {
  const shouldReduceMotion = useReducedMotion();
  const hasError = errorMessage !== undefined;

  return (
    <m.main
      className="bg-background text-foreground fixed inset-0 z-50 flex h-svh items-center justify-center px-6"
      exit={
        shouldReduceMotion
          ? { opacity: 0 }
          : { filter: "blur(8px)", opacity: 0, scale: 0.985, y: -8 }
      }
      transition={easeInOut(shouldReduceMotion ? 0.18 : 0.45)}
    >
      <section className="flex w-full max-w-80 flex-col items-center gap-5 text-center">
        <div className="border-border bg-secondary/60 text-muted-foreground flex size-11 items-center justify-center rounded-md border shadow-sm">
          {hasError ? (
            <CircleAlertIcon aria-hidden="true" className="size-5" />
          ) : (
            <Spinner className="size-5" />
          )}
        </div>
        <output aria-live="polite" className="space-y-1.5">
          <span className="block text-sm font-medium">
            {getStatusLabel(errorMessage)}
          </span>
          <span className="text-muted-foreground block text-xs/5">
            {getStatusDescription(errorMessage)}
          </span>
        </output>
        {hasError ? (
          <Button onClick={onRetry} variant="outline">
            Retry
          </Button>
        ) : null}
      </section>
    </m.main>
  );
};

export default StartupSplash;
