import { useEffect, useState } from "react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { getAppLifecycleApi } from "@/platform/desktop";

const AppClosingOverlay = () => {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(
    () =>
      getAppLifecycleApi()?.onClosing(() => {
        setIsClosing(true);
      }),
    []
  );

  if (!isClosing) {
    return null;
  }

  return (
    <div
      aria-busy="true"
      className="bg-background text-foreground fixed inset-0 z-100 flex h-svh items-center justify-center px-6"
    >
      <Empty className="max-w-80 flex-none gap-5 border-0">
        <EmptyMedia variant="icon">
          <Spinner aria-label="Closing" />
        </EmptyMedia>
        <output aria-live="assertive">
          <EmptyHeader className="gap-1.5">
            <EmptyTitle>Closing Kisa</EmptyTitle>
            <EmptyDescription className="text-xs/5">
              Finishing up
            </EmptyDescription>
          </EmptyHeader>
        </output>
      </Empty>
    </div>
  );
};

export default AppClosingOverlay;
