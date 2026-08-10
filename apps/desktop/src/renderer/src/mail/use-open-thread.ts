import { useCallback } from "react";
import { toast } from "sonner";

import type { ThreadSelection } from "@/mail/thread-selection";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import type { WindowApi } from "@/platform/desktop";
import { getWindowApi } from "@/platform/desktop";
import { useOpenThreadsInNewWindows } from "@/state/general-settings";
import { useMailboxStore } from "@/state/mailbox";

type ThreadOpeningLocation = "inline" | "window";

interface OpenThreadDependencies {
  readonly alwaysOpenInNewWindow: boolean;
  readonly closeInline: () => void;
  readonly openInline: (threadKey: string) => void;
  readonly reportError: (message: string) => void;
  readonly selectThread: (threadKey: string) => void;
  readonly windowApi?: WindowApi;
}

const openThreadWindow = async (
  thread: ThreadSelection,
  windowApi: WindowApi,
  reportError: (message: string) => void
): Promise<void> => {
  try {
    const reply = await windowApi.openThread(thread);

    if (!reply.ok) {
      reportError(reply.error);
    }
  } catch {
    reportError("Could not open the conversation in a new window");
  }
};

export const openThreadWithPreference = (
  thread: ThreadSelection,
  {
    alwaysOpenInNewWindow,
    closeInline,
    openInline,
    reportError,
    selectThread,
    windowApi,
  }: OpenThreadDependencies
): ThreadOpeningLocation => {
  const threadKey = getThreadSelectionKey(thread);

  if (!alwaysOpenInNewWindow || windowApi === undefined) {
    openInline(threadKey);
    return "inline";
  }

  closeInline();
  selectThread(threadKey);
  void openThreadWindow(thread, windowApi, reportError);

  return "window";
};

export const useOpenThread = () => {
  const alwaysOpenInNewWindow = useOpenThreadsInNewWindows();
  const closeInline = useMailboxStore((state) => state.closeThread);
  const openInline = useMailboxStore((state) => state.openThread);
  const selectThread = useMailboxStore((state) => state.selectThread);
  const windowApi = getWindowApi();

  return useCallback(
    (thread) =>
      openThreadWithPreference(thread, {
        alwaysOpenInNewWindow,
        closeInline,
        openInline,
        reportError: toast.error,
        selectThread,
        windowApi,
      }),
    [alwaysOpenInNewWindow, closeInline, openInline, selectThread, windowApi]
  );
};
