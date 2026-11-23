import { useMemo } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";
import type { MailThreadRequest } from "@/shared/ipc/mail";
import { useOfferUndo } from "@/undo/undo-provider";

import { beginPendingThreadChange } from "./pending-thread-changes";
import {
  fromBulkReply,
  fromThreadReply,
  runThreadAction,
  toThreadMutationOperation,
} from "./thread-action-runner";
import type {
  ThreadActionPlan,
  ThreadActionPorts,
} from "./thread-action-runner";

export interface ThreadActionTarget {
  accountId: string;
  isUnread: boolean;
  threadId: string;
}

export interface ThreadLabelChange {
  readonly applied: boolean;
  readonly labelId: string;
  /** Conversations list user labels by name, so the change shows by name. */
  readonly labelName: string;
}

type OnLeave = () => void;

export interface ThreadActions {
  bulkDeleteForever: (threads: readonly MailThreadRequest[]) => void;
  bulkSetLabel: (
    threads: readonly MailThreadRequest[],
    label: ThreadLabelChange
  ) => void;
  bulkSetReadState: (
    threads: readonly MailThreadRequest[],
    isUnread: boolean
  ) => void;
  bulkTrash: (threads: readonly MailThreadRequest[]) => void;
  deleteForever: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
  notSpam: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
  setLabel: (thread: MailThreadRequest, label: ThreadLabelChange) => void;
  toggleRead: (thread: ThreadActionTarget) => void;
  trash: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
}

interface ThreadActionsOptions {
  /** See `ThreadActionPlan.leaveAfterConfirmation`. */
  readonly leaveAfterConfirmation?: boolean;
}

const doNothing = (): void => undefined;

const NO_THREAD_ACTIONS: ThreadActions = {
  bulkDeleteForever: doNothing,
  bulkSetLabel: doNothing,
  bulkSetReadState: doNothing,
  bulkTrash: doNothing,
  deleteForever: doNothing,
  notSpam: doNothing,
  setLabel: doNothing,
  toggleRead: doNothing,
  trash: doNothing,
};

// Rows and conversations carry more than the request; only the key crosses.
const toRequest = ({
  accountId,
  threadId,
}: MailThreadRequest): MailThreadRequest => ({ accountId, threadId });

const toLabelChange = (label: ThreadLabelChange, applied: boolean) =>
  ({
    applied,
    kind: "setLabel",
    labelId: label.labelId,
    labelName: label.labelName,
  }) as const;

/**
 * All mouse and keyboard thread actions enter through this hook. Each shows
 * at once in this window; main owns the server and cache mutation, and its
 * thread list event carries the authoritative result to every window.
 */
export const useThreadActions = ({
  leaveAfterConfirmation = false,
}: ThreadActionsOptions = {}): ThreadActions => {
  const offerUndo = useOfferUndo();

  return useMemo((): ThreadActions => {
    const mailApi = getMailApi();

    if (mailApi === undefined) {
      return NO_THREAD_ACTIONS;
    }

    const ports: ThreadActionPorts = {
      bulkMutateThreads: mailApi.bulkMutateThreads,
      notifyError: (message, { description, id }) => {
        toast.error(message, { description, id });
      },
      notifySuccess: (message) => toast.success(message),
      offerUndo,
      showPending: beginPendingThreadChange,
    };
    const run = (plan: ThreadActionPlan): void => {
      void runThreadAction(ports, { ...plan, leaveAfterConfirmation });
    };
    const runBulk = (
      threads: readonly MailThreadRequest[],
      plan: Omit<ThreadActionPlan, "send" | "threads">
    ): void => {
      const requests = threads.map(toRequest);

      run({
        ...plan,
        send: () =>
          fromBulkReply(
            requests,
            () =>
              mailApi.bulkMutateThreads({
                operation: toThreadMutationOperation(plan.change),
                threads: requests,
              }),
            plan.failureMessage
          ),
        threads: requests,
      });
    };
    const runOne = (
      thread: MailThreadRequest,
      plan: Omit<ThreadActionPlan, "send" | "threads">,
      send: (request: MailThreadRequest) => ReturnType<typeof fromThreadReply>
    ): void => {
      const request = toRequest(thread);

      run({ ...plan, send: () => send(request), threads: [request] });
    };

    return {
      bulkDeleteForever: (threads) => {
        runBulk(threads, {
          change: { kind: "deleteForever" },
          failureMessage: "Some conversations were not deleted",
          message: "Conversations permanently deleted",
        });
      },
      bulkSetLabel: (threads, label) => {
        runBulk(threads, {
          change: toLabelChange(label, label.applied),
          failureMessage: "Some labels were not updated",
          message: label.applied
            ? "Label added to conversations"
            : "Label removed from conversations",
          undo: {
            change: toLabelChange(label, !label.applied),
            failureMessage: "Could not undo the label change",
            undoneMessage: label.applied
              ? "Removed the label from conversations"
              : "Restored the label to conversations",
          },
        });
      },
      bulkSetReadState: (threads, isUnread) => {
        runBulk(threads, {
          change: { isUnread, kind: "setReadState" },
          failureMessage: "Some conversations were not updated",
          message: isUnread
            ? "Marked conversations as unread"
            : "Marked conversations as read",
        });
      },
      bulkTrash: (threads) => {
        runBulk(threads, {
          change: { kind: "trash" },
          failureMessage: "Some conversations were not moved to trash",
          message: "Moved conversations to trash",
          undo: {
            change: { kind: "moveToInbox" },
            failureMessage: "Could not restore the conversations",
            undoneMessage: "Restored conversations to the inbox",
          },
        });
      },
      deleteForever: (thread, onLeave) => {
        const failureMessage = "Could not permanently delete email";

        runOne(
          thread,
          {
            change: { kind: "deleteForever" },
            failureMessage,
            message: "Conversation permanently deleted",
            onLeave,
          },
          (request) =>
            fromThreadReply(
              request,
              () => mailApi.deleteThreadForever(request),
              failureMessage
            )
        );
      },
      notSpam: (thread, onLeave) => {
        const failureMessage = "Could not mark email as not spam";

        runOne(
          thread,
          {
            change: { kind: "moveToInbox" },
            failureMessage,
            message: "Moved conversation to the inbox",
            onLeave,
            undo: {
              change: { kind: "moveToSpam" },
              failureMessage: "Could not move the conversation back to spam",
              undoneMessage: "Moved conversation back to spam",
            },
          },
          (request) =>
            fromThreadReply(
              request,
              () => mailApi.markThreadNotSpam(request),
              failureMessage
            )
        );
      },
      setLabel: (thread, label) => {
        const failureMessage = "Could not update email labels";

        runOne(
          thread,
          {
            change: toLabelChange(label, label.applied),
            failureMessage,
            message: label.applied ? "Label added" : "Label removed",
            undo: {
              change: toLabelChange(label, !label.applied),
              failureMessage: "Could not restore the email label",
              undoneMessage: label.applied
                ? "Label removed again"
                : "Label restored",
            },
          },
          (request) =>
            fromThreadReply(
              request,
              () =>
                mailApi.setThreadLabel({
                  ...request,
                  applied: label.applied,
                  labelId: label.labelId,
                }),
              failureMessage
            )
        );
      },
      toggleRead: (thread) => {
        const isUnread = !thread.isUnread;
        const failureMessage = "Could not update email";

        runOne(
          thread,
          {
            change: { isUnread, kind: "setReadState" },
            failureMessage,
            message: isUnread ? "Marked as unread" : "Marked as read",
          },
          (request) =>
            fromThreadReply(
              request,
              () => mailApi.setThreadReadState({ ...request, isUnread }),
              failureMessage
            )
        );
      },
      trash: (thread, onLeave) => {
        const failureMessage = "Could not move email to trash";

        runOne(
          thread,
          {
            change: { kind: "trash" },
            failureMessage,
            message: "Moved conversation to trash",
            onLeave,
            undo: {
              change: { kind: "moveToInbox" },
              failureMessage: "Could not restore the conversation",
              undoneMessage: "Restored conversation to the inbox",
            },
          },
          (request) =>
            fromThreadReply(
              request,
              () => mailApi.trashThread(request),
              failureMessage
            )
        );
      },
    };
  }, [leaveAfterConfirmation, offerUndo]);
};
