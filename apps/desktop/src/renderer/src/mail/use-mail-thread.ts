import { useEffect, useMemo, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type { MailThread, MailThreadReply } from "@/shared/ipc/mail";

import { toOpenThreadUpdate } from "./open-thread-update";

type MailThreadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "ready"; thread: MailThread };

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
    // How many messages the shown conversation holds, and whether a newer
    // read is wanted while one is in flight.
    let shownMessageCount: number | undefined;
    let isLoading = false;
    let isReloadWanted = false;

    const show = (reply: MailThreadReply): void => {
      if (reply.ok) {
        shownMessageCount = reply.data.messages.length;
        setResult({
          accountId,
          state: { status: "ready", thread: reply.data },
          threadId,
        });
        return;
      }

      // A failed reread keeps the conversation already on screen.
      setResult((current) =>
        current.state.status === "ready" &&
        current.accountId === accountId &&
        current.threadId === threadId
          ? current
          : {
              accountId,
              state: { message: reply.error, status: "error" },
              threadId,
            }
      );
    };

    const load = async (): Promise<void> => {
      if (isLoading) {
        isReloadWanted = true;
        return;
      }
      isLoading = true;
      let reply: MailThreadReply | undefined;
      try {
        reply = await mailApi.loadThread({ accountId, threadId });
      } catch {
        reply = { error: "Could not load email", ok: false };
      }
      isLoading = false;

      if (!isActive) {
        return;
      }
      show(reply);
      if (isReloadWanted) {
        isReloadWanted = false;
        void load();
      }
    };

    const unsubscribeThreadList = mailApi.onThreadListUpdated(({ changes }) => {
      const update = toOpenThreadUpdate(changes, {
        accountId,
        shownMessageCount,
        threadId,
      });

      if (update === undefined) {
        return;
      }
      if (update.kind === "reread") {
        void load();
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
                thread: { ...current.state.thread, labels: update.labels },
              },
            }
          : current
      );
    });

    void load();

    return () => {
      isActive = false;
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
