import { useCallback } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";
import type {
  GmailThreadMutationReply,
  GmailThreadSummary,
} from "@/shared/ipc/mail";

import type { ThreadPatch } from "./mailbox-model";
import { toReadStateThread, toTrashedThread } from "./mailbox-model";
import { getThreadSelectionKey } from "./thread-selection";

type PatchThread = (threadKey: string, patch: ThreadPatch) => void;

interface ThreadActions {
  toggleRead: (thread: GmailThreadSummary) => void;
  trash: (thread: GmailThreadSummary) => void;
}

/**
 * Quick actions apply locally first: Gmail round-trips take long enough that
 * waiting reads as a dead click. A failed call puts the thread back exactly as
 * it was, which is why the rollback replays the original rather than inverting
 * the edit — a background sync may have changed the thread in between.
 */
export const useThreadActions = (patchThread: PatchThread): ThreadActions => {
  const mailApi = getMailApi();
  const runThreadAction = useCallback(
    (
      thread: GmailThreadSummary,
      patch: ThreadPatch,
      send: () => Promise<GmailThreadMutationReply>,
      fallbackMessage: string
    ): void => {
      const threadKey = getThreadSelectionKey(thread);
      const rollBack = (message: string): void => {
        patchThread(threadKey, () => thread);
        toast.error(message);
      };

      patchThread(threadKey, patch);

      void (async () => {
        try {
          const reply = await send();

          if (!reply.ok) {
            rollBack(reply.error);
          }
        } catch (error) {
          // A rejected invoke means the channel never answered, so the edit is
          // only ever local and has to come back off.
          rollBack(error instanceof Error ? error.message : fallbackMessage);
        }
      })();
    },
    [patchThread]
  );

  const toggleRead = useCallback(
    (thread: GmailThreadSummary): void => {
      if (mailApi === undefined) {
        return;
      }

      const isUnread = !thread.isUnread;

      runThreadAction(
        thread,
        (current) => toReadStateThread(current, isUnread),
        () =>
          mailApi.setThreadReadState({
            accountId: thread.accountId,
            isUnread,
            threadId: thread.threadId,
          }),
        "Could not update email"
      );
    },
    [mailApi, runThreadAction]
  );

  const trash = useCallback(
    (thread: GmailThreadSummary): void => {
      if (mailApi === undefined) {
        return;
      }

      runThreadAction(
        thread,
        toTrashedThread,
        () =>
          mailApi.trashThread({
            accountId: thread.accountId,
            threadId: thread.threadId,
          }),
        "Could not move email to trash"
      );
    },
    [mailApi, runThreadAction]
  );

  return { toggleRead, trash };
};
