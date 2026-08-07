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

    void load();

    return () => {
      isActive = false;
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
