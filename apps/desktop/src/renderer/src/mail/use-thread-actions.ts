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
  deleteSpam: (
    thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
    onSuccess?: OnThreadActionSuccess
  ) => void;
  notSpam: (
    thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
    onSuccess?: OnThreadActionSuccess
  ) => void;
  setLabel: (
    thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
    label: { readonly applied: boolean; readonly labelId: string }
  ) => Promise<void>;
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
    async (
      send: () => Promise<GmailThreadMutationReply>,
      fallbackMessage: string,
      onSuccess?: OnThreadActionSuccess
    ): Promise<void> => {
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
    },
    []
  );

  const toggleRead = useCallback(
    (thread: ThreadActionTarget, onSuccess?: OnThreadActionSuccess): void => {
      if (mailApi === undefined) {
        return;
      }

      void runThreadAction(
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

  const setLabel = useCallback(
    (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      label: { readonly applied: boolean; readonly labelId: string }
    ): Promise<void> => {
      if (mailApi === undefined) {
        return Promise.resolve();
      }

      return runThreadAction(
        () =>
          mailApi.setThreadLabel({
            accountId: thread.accountId,
            applied: label.applied,
            labelId: label.labelId,
            threadId: thread.threadId,
          }),
        "Could not update email labels"
      );
    },
    [mailApi, runThreadAction]
  );

  const notSpam = useCallback(
    (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      onSuccess?: OnThreadActionSuccess
    ): void => {
      if (mailApi === undefined) {
        return;
      }

      void runThreadAction(
        () =>
          mailApi.markThreadNotSpam({
            accountId: thread.accountId,
            threadId: thread.threadId,
          }),
        "Could not mark email as not spam",
        onSuccess
      );
    },
    [mailApi, runThreadAction]
  );

  const deleteSpam = useCallback(
    (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      onSuccess?: OnThreadActionSuccess
    ): void => {
      if (mailApi === undefined) {
        return;
      }

      void runThreadAction(
        () =>
          mailApi.deleteSpamThread({
            accountId: thread.accountId,
            threadId: thread.threadId,
          }),
        "Could not permanently delete email",
        () => {
          toast.success("Conversation permanently deleted");
          onSuccess?.();
        }
      );
    },
    [mailApi, runThreadAction]
  );

  const trash = useCallback(
    (thread: ThreadActionTarget, onSuccess?: OnThreadActionSuccess): void => {
      if (mailApi === undefined) {
        return;
      }

      void runThreadAction(
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

  return { deleteSpam, notSpam, setLabel, toggleRead, trash };
};
