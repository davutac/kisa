import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { getMailApi } from "@/platform/desktop";

type PendingThreadAction = "read-state" | "trash" | null;

interface ThreadDetailActions {
  isPending: boolean;
  isUnread: boolean;
  toggleRead: () => void;
  trash: () => void;
}

interface UseThreadDetailActionsOptions {
  accountId: string;
  initialIsUnread: boolean;
  onReadStateChanged: (isUnread: boolean) => void;
  onTrashed: () => void;
  threadId: string;
}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

/**
 * Detail actions own their optimistic read state because a loaded conversation
 * is not necessarily part of the visible inbox (search can open archived mail).
 * The main process publishes the resulting mailbox change after Gmail accepts
 * it, while this hook keeps the open header responsive and rolls it back on an
 * IPC or Gmail failure.
 */
export const useThreadDetailActions = ({
  accountId,
  initialIsUnread,
  onReadStateChanged,
  onTrashed,
  threadId,
}: UseThreadDetailActionsOptions): ThreadDetailActions => {
  const mailApi = useMemo(() => getMailApi(), []);
  const [isUnread, setIsUnread] = useState(initialIsUnread);
  const [pendingAction, setPendingAction] = useState<PendingThreadAction>(null);

  const toggleRead = useCallback((): void => {
    if (mailApi === undefined || pendingAction !== null) {
      return;
    }

    const nextIsUnread = !isUnread;

    setIsUnread(nextIsUnread);
    setPendingAction("read-state");

    void (async () => {
      try {
        const reply = await mailApi.setThreadReadState({
          accountId,
          isUnread: nextIsUnread,
          threadId,
        });

        if (!reply.ok) {
          setIsUnread(isUnread);
          toast.error(reply.error);
          return;
        }

        onReadStateChanged(nextIsUnread);
      } catch (error) {
        setIsUnread(isUnread);
        toast.error(getErrorMessage(error, "Could not update email"));
      } finally {
        setPendingAction(null);
      }
    })();
  }, [
    accountId,
    isUnread,
    mailApi,
    onReadStateChanged,
    pendingAction,
    threadId,
  ]);

  const trash = useCallback((): void => {
    if (mailApi === undefined || pendingAction !== null) {
      return;
    }

    setPendingAction("trash");

    void (async () => {
      try {
        const reply = await mailApi.trashThread({ accountId, threadId });

        if (!reply.ok) {
          toast.error(reply.error);
          setPendingAction(null);
          return;
        }

        onTrashed();
      } catch (error) {
        toast.error(getErrorMessage(error, "Could not move email to trash"));
        setPendingAction(null);
      }
    })();
  }, [accountId, mailApi, onTrashed, pendingAction, threadId]);

  return {
    isPending: pendingAction !== null || mailApi === undefined,
    isUnread,
    toggleRead,
    trash,
  };
};
