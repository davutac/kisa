import { useEffect, useMemo, useState } from "react";

import { getMailApi } from "@/platform/desktop";
import type { MailThread, MailThreadReply } from "@/shared/ipc/mail";

import { loadOpenThread, toOpenThreadUpdate } from "./open-thread-update";
import {
  beginPendingThreadChange,
  projectOpenThread,
  usePendingThreadChanges,
} from "./pending-thread-changes";

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
  const pendingChanges = usePendingThreadChanges();
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

    const read = async (cachedOnly: boolean): Promise<MailThreadReply> => {
      try {
        return await mailApi.loadThread({ accountId, cachedOnly, threadId });
      } catch {
        return { error: "Could not load email", ok: false };
      }
    };

    const load = async (): Promise<void> => {
      if (isLoading) {
        isReloadWanted = true;
        return;
      }
      isLoading = true;
      // Main marks an unread conversation read as it opens it; the list shows
      // that now rather than after the server has it.
      const settleRead = beginPendingThreadChange([{ accountId, threadId }], {
        isUnread: false,
        kind: "setReadState",
      });
      await loadOpenThread({ isShown: () => isActive, read, show });
      settleRead();
      isLoading = false;

      if (!isActive) {
        return;
      }
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
                thread: {
                  ...current.state.thread,
                  labels: update.labels,
                  places: update.places,
                },
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

  if (result.accountId !== accountId || result.threadId !== threadId) {
    return { status: "loading" };
  }

  if (result.state.status !== "ready") {
    return result.state;
  }

  const { thread } = result.state;
  const projected = projectOpenThread(thread, pendingChanges);

  return projected === thread
    ? result.state
    : { status: "ready", thread: { ...thread, ...projected } };
};
