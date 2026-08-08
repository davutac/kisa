import { useCallback } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";
import type { GmailThreadMutationReply } from "@/shared/ipc/mail";

export interface ThreadActionTarget {
  accountId: string;
  isUnread: boolean;
  threadId: string;
}

type OnThreadActionSuccess = () => void;

export interface ThreadActions {
  toggleRead: (
    thread: ThreadActionTarget,
    onSuccess?: OnThreadActionSuccess
  ) => void;
  trash: (
    thread: ThreadActionTarget,
    onSuccess?: OnThreadActionSuccess
  ) => void;
}

/**
 * Every thread action enters through this hook. The main process performs the
 * Gmail and cache mutation, then publishes the resulting list projection; the
 * renderer list and open thread both reconcile from that one typed event.
 */
export const useThreadActions = (): ThreadActions => {
  const mailApi = getMailApi();
  const runThreadAction = useCallback(
    (
      send: () => Promise<GmailThreadMutationReply>,
      fallbackMessage: string,
      onSuccess?: OnThreadActionSuccess
    ): void => {
      void (async () => {
        try {
          const reply = await send();

          if (!reply.ok) {
            toast.error(reply.error);
            return;
          }

          onSuccess?.();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : fallbackMessage);
        }
      })();
    },
    []
  );

  const toggleRead = useCallback(
    (thread: ThreadActionTarget, onSuccess?: OnThreadActionSuccess): void => {
      if (mailApi === undefined) {
        return;
      }

      runThreadAction(
        () =>
          mailApi.setThreadReadState({
            accountId: thread.accountId,
            isUnread: !thread.isUnread,
            threadId: thread.threadId,
          }),
        "Could not update email",
        onSuccess
      );
    },
    [mailApi, runThreadAction]
  );

  const trash = useCallback(
    (thread: ThreadActionTarget, onSuccess?: OnThreadActionSuccess): void => {
      if (mailApi === undefined) {
        return;
      }

      runThreadAction(
        () =>
          mailApi.trashThread({
            accountId: thread.accountId,
            threadId: thread.threadId,
          }),
        "Could not move email to trash",
        onSuccess
      );
    },
    [mailApi, runThreadAction]
  );

  return { toggleRead, trash };
};
