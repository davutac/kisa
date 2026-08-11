import { FileWarningIcon } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";

export const PreviewPending = ({ label }: { label: string }) => (
  <div
    aria-live="polite"
    className="text-muted-foreground flex min-h-full items-center justify-center gap-2 text-sm"
  >
    <Spinner />
    {label}
  </div>
);

export const PreviewError = ({ message }: { message: string }) => (
  <div className="text-muted-foreground flex min-h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm">
    <FileWarningIcon aria-hidden="true" className="size-8" />
    <p>{message}</p>
  </div>
);
