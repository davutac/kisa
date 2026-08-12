import { useCallback } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";
import type {
  GmailBulkThreadMutationOperation,
  GmailThreadMutationReply,
  GmailThreadRequest,
} from "@/shared/ipc/mail";

export interface ThreadActionTarget {
  accountId: string;
  isUnread: boolean;
  threadId: string;
}

type OnThreadActionSuccess = () => void;

const labelSuccessMessage = (applied: boolean): string =>
  applied ? "Label added to conversations" : "Label removed from conversations";

export interface ThreadActions {
  bulkDeleteSpam: (
    threads: readonly Pick<ThreadActionTarget, "accountId" | "threadId">[]
  ) => Promise<void>;
  bulkSetLabel: (
    threads: readonly Pick<ThreadActionTarget, "accountId" | "threadId">[],
    label: { readonly applied: boolean; readonly labelId: string }
  ) => Promise<void>;
  bulkSetReadState: (
    threads: readonly ThreadActionTarget[],
    isUnread: boolean
  ) => Promise<void>;
  bulkTrash: (threads: readonly ThreadActionTarget[]) => Promise<void>;
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

  const runBulkAction = useCallback(
    async (
      threads: readonly GmailThreadRequest[],
      operation: GmailBulkThreadMutationOperation,
      successMessage: string,
      failureMessage: string
    ): Promise<void> => {
      if (mailApi === undefined || threads.length === 0) {
        return;
      }

      try {
        const reply = await mailApi.bulkMutateThreads({ operation, threads });

        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }

        if (reply.data.failed.length === 0) {
          toast.success(successMessage);
          return;
        }

        toast.error(failureMessage, {
          description: `${reply.data.failed.length} of ${threads.length} conversations could not be updated.`,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update emails"
        );
      }
    },
    [mailApi]
  );

  const bulkSetReadState = useCallback(
    (
      threads: readonly ThreadActionTarget[],
      isUnread: boolean
    ): Promise<void> =>
      runBulkAction(
        threads.map(({ accountId, threadId }) => ({ accountId, threadId })),
        { isUnread, kind: "setReadState" },
        isUnread
          ? "Marked conversations as unread"
          : "Marked conversations as read",
        "Some conversations were not updated"
      ),
    [runBulkAction]
  );

  const bulkTrash = useCallback(
    (threads: readonly ThreadActionTarget[]): Promise<void> =>
      runBulkAction(
        threads.map(({ accountId, threadId }) => ({ accountId, threadId })),
        { kind: "trash" },
        "Moved conversations to trash",
        "Some conversations were not moved to trash"
      ),
    [runBulkAction]
  );

  const bulkDeleteSpam = useCallback(
    (
      threads: readonly Pick<ThreadActionTarget, "accountId" | "threadId">[]
    ): Promise<void> =>
      runBulkAction(
        threads,
        { kind: "deleteSpam" },
        "Conversations permanently deleted",
        "Some conversations were not deleted"
      ),
    [runBulkAction]
  );

  const bulkSetLabel = useCallback(
    (
      threads: readonly Pick<ThreadActionTarget, "accountId" | "threadId">[],
      label: { readonly applied: boolean; readonly labelId: string }
    ): Promise<void> =>
      runBulkAction(
        threads,
        {
          applied: label.applied,
          kind: "setLabel",
          labelId: label.labelId,
        },
        labelSuccessMessage(label.applied),
        "Some labels were not updated"
      ),
    [runBulkAction]
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
        () => {
          toast.success(
            thread.isUnread ? "Marked as read" : "Marked as unread"
          );
          onSuccess?.();
        }
      );
    },
    [mailApi, runThreadAction]
  );

  const setLabel = useCallback(
    async (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      label: { readonly applied: boolean; readonly labelId: string }
    ): Promise<void> => {
      if (mailApi === undefined) {
        return;
      }

      await runThreadAction(
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

  return {
    bulkDeleteSpam,
    bulkSetLabel,
    bulkSetReadState,
    bulkTrash,
    deleteSpam,
    notSpam,
    setLabel,
    toggleRead,
    trash,
  };
};
