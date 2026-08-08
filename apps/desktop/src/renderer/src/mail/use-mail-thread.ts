import { useEffect, useMemo, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type { GmailThread } from "@/shared/ipc/mail";

type MailThreadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "ready"; thread: GmailThread };

interface MailThreadResult {
  accountId: string;
  state: MailThreadState;
  threadId: string;
}

export const useMailThread = (
  accountId: string,
  threadId: string
): MailThreadState => {
  const mailApi = useMemo(() => getMailApi(), []);
  const [result, setResult] = useState<MailThreadResult>({
    accountId,
    state: { status: "loading" },
    threadId,
  });

  useEffect(() => {
    if (mailApi === undefined) {
      return;
    }

    let isActive = true;
    const load = async (): Promise<void> => {
      const reply = await mailApi.loadThread({ accountId, threadId });

      if (!isActive) {
        return;
      }

      setResult({
        accountId,
        state: reply.ok
          ? { status: "ready", thread: reply.data }
          : { message: reply.error, status: "error" },
        threadId,
      });
    };

    const unsubscribe = mailApi.onThreadUpdated((updated) => {
      if (updated.accountId === accountId && updated.threadId === threadId) {
        setResult({
          accountId,
          state: { status: "ready", thread: updated },
          threadId,
        });
      }
    });
    const unsubscribeThreadList = mailApi.onThreadListUpdated(({ changes }) => {
      const updated = changes.find(
        (change) =>
          change.kind === "upsert" &&
          change.thread.accountId === accountId &&
          change.thread.threadId === threadId
      );

      if (updated === undefined || updated.kind !== "upsert") {
        return;
      }

      setResult((current) =>
        current.accountId === accountId &&
        current.threadId === threadId &&
        current.state.status === "ready"
          ? {
              ...current,
              state: {
                status: "ready",
                thread: {
                  ...current.state.thread,
                  labels: updated.thread.labels,
                },
              },
            }
          : current
      );
    });

    void load();

    return () => {
      isActive = false;
      unsubscribe();
      unsubscribeThreadList();
    };
  }, [accountId, mailApi, threadId]);

  if (mailApi === undefined) {
    return {
      message: "Email is unavailable outside the desktop app.",
      status: "error",
    };
  }

  return result.accountId === accountId && result.threadId === threadId
    ? result.state
    : { status: "loading" };
};
