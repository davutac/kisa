import { useCallback } from "react";

import { useThreadActionRunner } from "@/mail/use-thread-action-runner";

export interface ThreadActionTarget {
  accountId: string;
  isUnread: boolean;
  threadId: string;
}

type OnThreadActionSuccess = () => void;

const labelSuccessMessage = (applied: boolean): string =>
  applied ? "Label added to conversations" : "Label removed from conversations";

const labelUndoMessage = (applied: boolean): string =>
  applied
    ? "Removed the label from conversations"
    : "Restored the label to conversations";

export interface ThreadActions {
  bulkDeleteForever: (
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
  deleteForever: (
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
 * All mouse and keyboard thread actions enter through this hook. Main owns the
 * Gmail/cache mutation and publishes the authoritative renderer projection.
 */
export const useThreadActions = (): ThreadActions => {
  const { runBulkAction, runThreadAction } = useThreadActionRunner();

  const bulkSetReadState = useCallback(
    (
      threads: readonly ThreadActionTarget[],
      isUnread: boolean
    ): Promise<void> =>
      runBulkAction({
        failureMessage: "Some conversations were not updated",
        operation: { isUnread, kind: "setReadState" },
        successMessage: isUnread
          ? "Marked conversations as unread"
          : "Marked conversations as read",
        threads: threads.map(({ accountId, threadId }) => ({
          accountId,
          threadId,
        })),
      }),
    [runBulkAction]
  );

  const bulkTrash = useCallback(
    (threads: readonly ThreadActionTarget[]): Promise<void> =>
      runBulkAction({
        failureMessage: "Some conversations were not moved to trash",
        operation: { kind: "trash" },
        successMessage: "Moved conversations to trash",
        threads: threads.map(({ accountId, threadId }) => ({
          accountId,
          threadId,
        })),
        undo: {
          operation: { kind: "moveToInbox" },
          undoneMessage: "Restored conversations to the inbox",
        },
      }),
    [runBulkAction]
  );

  const bulkDeleteForever = useCallback(
    (
      threads: readonly Pick<ThreadActionTarget, "accountId" | "threadId">[]
    ): Promise<void> =>
      runBulkAction({
        failureMessage: "Some conversations were not deleted",
        operation: { kind: "deleteForever" },
        successMessage: "Conversations permanently deleted",
        threads,
      }),
    [runBulkAction]
  );

  const bulkSetLabel = useCallback(
    (
      threads: readonly Pick<ThreadActionTarget, "accountId" | "threadId">[],
      label: { readonly applied: boolean; readonly labelId: string }
    ): Promise<void> =>
      runBulkAction({
        failureMessage: "Some labels were not updated",
        operation: {
          applied: label.applied,
          kind: "setLabel",
          labelId: label.labelId,
        },
        successMessage: labelSuccessMessage(label.applied),
        threads,
        undo: {
          operation: {
            applied: !label.applied,
            kind: "setLabel",
            labelId: label.labelId,
          },
          undoneMessage: labelUndoMessage(label.applied),
        },
      }),
    [runBulkAction]
  );

  const toggleRead = useCallback(
    (thread: ThreadActionTarget, onSuccess?: OnThreadActionSuccess): void => {
      const isUnread = !thread.isUnread;

      void runThreadAction({
        failureMessage: "Could not update email",
        onSuccess,
        send: (mailApi) =>
          mailApi.setThreadReadState({
            accountId: thread.accountId,
            isUnread,
            threadId: thread.threadId,
          }),
        successMessage: isUnread ? "Marked as unread" : "Marked as read",
      });
    },
    [runThreadAction]
  );

  const setLabel = useCallback(
    (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      label: { readonly applied: boolean; readonly labelId: string }
    ): Promise<void> =>
      runThreadAction({
        failureMessage: "Could not update email labels",
        send: (mailApi) =>
          mailApi.setThreadLabel({
            accountId: thread.accountId,
            applied: label.applied,
            labelId: label.labelId,
            threadId: thread.threadId,
          }),
        undo: {
          failureMessage: "Could not restore the email label",
          kind: "thread",
          message: label.applied ? "Label added" : "Label removed",
          send: (mailApi) =>
            mailApi.setThreadLabel({
              accountId: thread.accountId,
              applied: !label.applied,
              labelId: label.labelId,
              threadId: thread.threadId,
            }),
          undoneMessage: label.applied
            ? "Label removed again"
            : "Label restored",
        },
      }),
    [runThreadAction]
  );

  const notSpam = useCallback(
    (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      onSuccess?: OnThreadActionSuccess
    ): void => {
      void runThreadAction({
        failureMessage: "Could not mark email as not spam",
        onSuccess,
        send: (mailApi) => mailApi.markThreadNotSpam(thread),
        undo: {
          failureMessage: "Could not move the conversation back to spam",
          kind: "bulk",
          message: "Moved conversation to the inbox",
          operation: { kind: "moveToSpam" },
          threads: [thread],
          undoneMessage: "Moved conversation back to spam",
        },
      });
    },
    [runThreadAction]
  );

  const deleteForever = useCallback(
    (
      thread: Pick<ThreadActionTarget, "accountId" | "threadId">,
      onSuccess?: OnThreadActionSuccess
    ): void => {
      void runThreadAction({
        failureMessage: "Could not permanently delete email",
        onSuccess,
        send: (mailApi) => mailApi.deleteThreadForever(thread),
        successMessage: "Conversation permanently deleted",
      });
    },
    [runThreadAction]
  );

  const trash = useCallback(
    (thread: ThreadActionTarget, onSuccess?: OnThreadActionSuccess): void => {
      const request = {
        accountId: thread.accountId,
        threadId: thread.threadId,
      };

      void runThreadAction({
        failureMessage: "Could not move email to trash",
        onSuccess,
        send: (mailApi) => mailApi.trashThread(request),
        undo: {
          failureMessage: "Could not restore the conversation",
          kind: "bulk",
          message: "Moved conversation to trash",
          operation: { kind: "moveToInbox" },
          threads: [request],
          undoneMessage: "Restored conversation to the inbox",
        },
      });
    },
    [runThreadAction]
  );

  return {
    bulkDeleteForever,
    bulkSetLabel,
    bulkSetReadState,
    bulkTrash,
    deleteForever,
    notSpam,
    setLabel,
    toggleRead,
    trash,
  };
};
