import { useCallback } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";
import type { MailApi } from "@/platform/desktop";
import type {
  GmailBulkThreadMutationOperation,
  GmailThreadMutationReply,
  GmailThreadRequest,
} from "@/shared/ipc/mail";
import { usePrepareUndo } from "@/undo/undo-provider";

interface UndoCopy {
  readonly failureMessage: string;
  readonly message: string;
  readonly undoneMessage: string;
}

type ThreadUndo = UndoCopy &
  (
    | {
        readonly kind: "bulk";
        readonly operation: GmailBulkThreadMutationOperation;
        readonly threads: readonly GmailThreadRequest[];
      }
    | {
        readonly kind: "thread";
        readonly send: (mailApi: MailApi) => Promise<GmailThreadMutationReply>;
      }
  );

interface ThreadAction {
  readonly failureMessage: string;
  readonly onSuccess?: () => void;
  readonly send: (mailApi: MailApi) => Promise<GmailThreadMutationReply>;
  readonly successMessage?: string;
  readonly undo?: ThreadUndo;
}

interface BulkAction {
  readonly failureMessage: string;
  readonly operation: GmailBulkThreadMutationOperation;
  readonly successMessage: string;
  readonly threads: readonly GmailThreadRequest[];
  readonly undo?: {
    readonly operation: GmailBulkThreadMutationOperation;
    readonly undoneMessage: string;
  };
}

const conversationCount = (count: number): string =>
  `${count} conversation${count === 1 ? "" : "s"}`;

const requireThreadMutation = async (
  mailApi: MailApi,
  undo: Extract<ThreadUndo, { readonly kind: "thread" }>
): Promise<void> => {
  try {
    const reply = await undo.send(mailApi);

    if (!reply.ok) {
      throw new Error(reply.error);
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(undo.failureMessage);
  }
};

const requireBulkMutation = async (
  mailApi: MailApi,
  threads: readonly GmailThreadRequest[],
  operation: GmailBulkThreadMutationOperation,
  failureMessage: string
): Promise<void> => {
  try {
    const reply = await mailApi.bulkMutateThreads({ operation, threads });

    if (!reply.ok) {
      throw new Error(reply.error);
    }

    if (reply.data.failed.length > 0) {
      throw new Error(
        `Could not undo for ${conversationCount(reply.data.failed.length)}`
      );
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(failureMessage);
  }
};

export const useThreadActionRunner = () => {
  const mailApi = getMailApi();
  const prepareUndo = usePrepareUndo();

  const runThreadAction = useCallback(
    async (action: ThreadAction): Promise<void> => {
      if (mailApi === undefined) {
        return;
      }

      const commitUndo = action.undo === undefined ? undefined : prepareUndo();

      try {
        const reply = await action.send(mailApi);

        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }

        if (action.undo !== undefined && commitUndo !== undefined) {
          const { undo } = action;
          commitUndo({
            message: undo.message,
            undo: () =>
              undo.kind === "thread"
                ? requireThreadMutation(mailApi, undo)
                : requireBulkMutation(
                    mailApi,
                    undo.threads,
                    undo.operation,
                    undo.failureMessage
                  ),
            undoneMessage: undo.undoneMessage,
          });
        } else if (action.successMessage !== undefined) {
          toast.success(action.successMessage);
        }

        action.onSuccess?.();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : action.failureMessage
        );
      }
    },
    [mailApi, prepareUndo]
  );

  const runBulkAction = useCallback(
    async (action: BulkAction): Promise<void> => {
      if (mailApi === undefined || action.threads.length === 0) {
        return;
      }

      const commitUndo = action.undo === undefined ? undefined : prepareUndo();

      try {
        const reply = await mailApi.bulkMutateThreads({
          operation: action.operation,
          threads: action.threads,
        });

        if (!reply.ok) {
          toast.error(reply.error);
          return;
        }

        const { failed, succeeded } = reply.data;
        const description = `${failed.length} of ${action.threads.length} conversations could not be updated.`;

        if (succeeded.length === 0) {
          toast.error(action.failureMessage, { description });
          return;
        }

        if (action.undo !== undefined && commitUndo !== undefined) {
          const { undo } = action;
          commitUndo({
            description: failed.length === 0 ? undefined : description,
            message:
              failed.length === 0
                ? action.successMessage
                : action.failureMessage,
            tone: failed.length === 0 ? "success" : "error",
            undo: () =>
              requireBulkMutation(
                mailApi,
                succeeded,
                undo.operation,
                "Could not undo the conversation update"
              ),
            undoneMessage: undo.undoneMessage,
          });
          return;
        }

        if (failed.length === 0) {
          toast.success(action.successMessage);
        } else {
          toast.error(action.failureMessage, { description });
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Could not update emails"
        );
      }
    },
    [mailApi, prepareUndo]
  );

  return { runBulkAction, runThreadAction };
};
