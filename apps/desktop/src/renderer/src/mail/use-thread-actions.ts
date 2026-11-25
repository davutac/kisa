import { useMemo } from "react";

import { toast } from "@/components/ui/toast";
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

export interface ThreadStarTarget {
  readonly accountId: string;
  readonly isStarred: boolean;
  readonly threadId: string;
}

export interface ThreadLabelChange {
  readonly applied: boolean;
  readonly labelId: string;
  /** Conversations list user labels by name, so the change shows by name. */
  readonly labelName: string;
}

type OnLeave = () => void;

export interface ThreadActions {
  archive: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
  /** Only conversations in the Inbox, so Undo returns only what left it. */
  bulkArchive: (threads: readonly MailThreadRequest[]) => void;
  bulkDeleteForever: (threads: readonly MailThreadRequest[]) => void;
  bulkReportSpam: (threads: readonly MailThreadRequest[]) => void;
  bulkSetLabel: (
    threads: readonly MailThreadRequest[],
    label: ThreadLabelChange
  ) => void;
  bulkSetReadState: (
    threads: readonly MailThreadRequest[],
    isUnread: boolean
  ) => void;
  bulkSetStarred: (
    threads: readonly MailThreadRequest[],
    isStarred: boolean
  ) => void;
  bulkTrash: (threads: readonly MailThreadRequest[]) => void;
  deleteForever: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
  /** Archive's way back, for a conversation that left the Inbox. */
  moveToInbox: (thread: MailThreadRequest) => void;
  notSpam: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
  reportSpam: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
  setLabel: (thread: MailThreadRequest, label: ThreadLabelChange) => void;
  toggleRead: (thread: ThreadActionTarget) => void;
  toggleStar: (thread: ThreadStarTarget) => void;
  trash: (thread: MailThreadRequest, onLeave?: OnLeave) => void;
}

interface ThreadActionsOptions {
  /** See `ThreadActionPlan.leaveAfterConfirmation`. */
  readonly leaveAfterConfirmation?: boolean;
}

const doNothing = (): void => undefined;

const NO_THREAD_ACTIONS: ThreadActions = {
  archive: doNothing,
  bulkArchive: doNothing,
  bulkDeleteForever: doNothing,
  bulkReportSpam: doNothing,
  bulkSetLabel: doNothing,
  bulkSetReadState: doNothing,
  bulkSetStarred: doNothing,
  bulkTrash: doNothing,
  deleteForever: doNothing,
  moveToInbox: doNothing,
  notSpam: doNothing,
  reportSpam: doNothing,
  setLabel: doNothing,
  toggleRead: doNothing,
  toggleStar: doNothing,
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

// Archive and Star are system labels, which conversations list by their id:
// leaving the Inbox is losing `INBOX`, and a star is `STARRED`.
const INBOX = "INBOX";
const STARRED = "STARRED";

const toSystemLabelChange = (labelId: string, applied: boolean) =>
  toLabelChange({ applied, labelId, labelName: labelId }, applied);

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

    const setSystemLabel = (
      request: MailThreadRequest,
      labelId: string,
      applied: boolean,
      failureMessage: string
    ) =>
      fromThreadReply(
        request,
        () => mailApi.setThreadLabel({ ...request, applied, labelId }),
        failureMessage
      );

    return {
      archive: (thread, onLeave) => {
        const failureMessage = "Could not archive email";

        runOne(
          thread,
          {
            change: toSystemLabelChange(INBOX, false),
            failureMessage,
            message: "Archived conversation",
            onLeave,
            undo: {
              change: toSystemLabelChange(INBOX, true),
              failureMessage: "Could not move the conversation to the inbox",
              undoneMessage: "Moved conversation back to the inbox",
            },
          },
          (request) => setSystemLabel(request, INBOX, false, failureMessage)
        );
      },
      bulkArchive: (threads) => {
        runBulk(threads, {
          change: toSystemLabelChange(INBOX, false),
          failureMessage: "Some conversations were not archived",
          message: "Archived conversations",
          undo: {
            change: toSystemLabelChange(INBOX, true),
            failureMessage: "Could not move the conversations to the inbox",
            undoneMessage: "Moved conversations back to the inbox",
          },
        });
      },
      bulkDeleteForever: (threads) => {
        runBulk(threads, {
          change: { kind: "deleteForever" },
          failureMessage: "Some conversations were not deleted",
          message: "Conversations permanently deleted",
        });
      },
      bulkReportSpam: (threads) => {
        runBulk(threads, {
          change: { kind: "moveToSpam" },
          failureMessage: "Some conversations were not reported as spam",
          message: "Reported conversations as spam",
          undo: {
            change: { kind: "moveToInbox" },
            failureMessage: "Could not restore the conversations",
            undoneMessage: "Restored the conversations",
          },
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
      bulkSetStarred: (threads, isStarred) => {
        runBulk(threads, {
          change: toSystemLabelChange(STARRED, isStarred),
          failureMessage: "Some conversations were not updated",
          message: isStarred
            ? "Starred conversations"
            : "Removed stars from conversations",
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
            undoneMessage: "Restored the conversations",
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
      moveToInbox: (thread) => {
        const failureMessage = "Could not move email to the inbox";

        runOne(
          thread,
          {
            change: toSystemLabelChange(INBOX, true),
            failureMessage,
            message: "Moved conversation to the inbox",
          },
          (request) => setSystemLabel(request, INBOX, true, failureMessage)
        );
      },
      notSpam: (thread, onLeave) => {
        const failureMessage = "Could not mark email as not spam";

        runOne(
          thread,
          {
            change: { kind: "moveToInbox" },
            failureMessage,
            // Not "to the inbox": mail reported here from a folder or from
            // Archive goes back there on iCloud and other IMAP accounts.
            message: "Marked conversation as not spam",
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
      reportSpam: (thread, onLeave) => {
        const failureMessage = "Could not report email as spam";

        runOne(
          thread,
          {
            change: { kind: "moveToSpam" },
            failureMessage,
            message: "Reported conversation as spam",
            onLeave,
            undo: {
              change: { kind: "moveToInbox" },
              failureMessage: "Could not restore the conversation",
              undoneMessage: "Restored the conversation",
            },
          },
          (request) =>
            fromThreadReply(
              request,
              () => mailApi.reportThreadSpam(request),
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
      toggleStar: (thread) => {
        const isStarred = !thread.isStarred;
        const failureMessage = "Could not update email";

        runOne(
          thread,
          {
            change: toSystemLabelChange(STARRED, isStarred),
            failureMessage,
            message: isStarred ? "Starred" : "Removed star",
          },
          (request) =>
            setSystemLabel(request, STARRED, isStarred, failureMessage)
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
              undoneMessage: "Restored the conversation",
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
