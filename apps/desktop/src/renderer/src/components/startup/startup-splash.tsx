import { CircleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";

interface StartupSplashProps {
  errorMessage?: string;
  onRetry?: () => void;
}

const getStatusLabel = (errorMessage: string | undefined): string => {
  if (errorMessage !== undefined) {
    return "Startup failed";
  }

  return "Waking Kisa";
};

const getStatusDescription = (errorMessage: string | undefined): string => {
  if (errorMessage !== undefined) {
    return errorMessage;
  }

  return "Sorting the mail before anyone notices";
};

const StartupSplash = ({ errorMessage, onRetry }: StartupSplashProps) => {
  const hasError = errorMessage !== undefined;

  return (
    <main className="bg-background text-foreground fixed inset-0 z-50 flex h-svh items-center justify-center px-6">
      <Empty className="max-w-80 flex-none gap-5 border-0">
        <EmptyMedia variant="icon">
          {hasError ? <CircleAlertIcon aria-hidden="true" /> : <Spinner />}
        </EmptyMedia>
        <output aria-live="polite">
          <EmptyHeader className="gap-1.5">
            <EmptyTitle>{getStatusLabel(errorMessage)}</EmptyTitle>
            <EmptyDescription className="text-xs/5">
              {getStatusDescription(errorMessage)}
            </EmptyDescription>
          </EmptyHeader>
        </output>
        {hasError ? (
          <EmptyContent>
            <Button onClick={onRetry} variant="outline">
              Retry
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </main>
  );
};

export default StartupSplash;
