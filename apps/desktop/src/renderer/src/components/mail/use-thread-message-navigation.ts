import { useCallback, useEffect, useMemo, useRef } from "react";

import { useThreadConversationStore } from "@/components/mail/thread-conversation-store";
import { useAppCommand } from "@/hotkeys";
import { getAdjacentMessageId } from "@/mail/message-selection";
import type { MessageSelectionDirection } from "@/mail/message-selection";
import type { GmailThreadMessage } from "@/shared/ipc/mail";

export const useThreadMessageNavigation = (
  messages: readonly GmailThreadMessage[]
) => {
  const messageHeaderRefs = useRef(new Map<string, HTMLButtonElement>());
  const expandedMessageId = useThreadConversationStore(
    (state) => state.expandedMessageId
  );
  const selectedMessageId = useThreadConversationStore(
    (state) => state.selectedMessageId
  );
  const openMessage = useThreadConversationStore((state) => state.openMessage);
  const reconcileMessages = useThreadConversationStore(
    (state) => state.reconcileMessages
  );
  const messageIds = useMemo(
    () => messages.map((message) => message.id),
    [messages]
  );

  useEffect(() => {
    reconcileMessages(messageIds);
  }, [messageIds, reconcileMessages]);

  const focusMessage = useCallback((messageId: string): void => {
    requestAnimationFrame(() => {
      messageHeaderRefs.current.get(messageId)?.focus({ preventScroll: true });
    });
  }, []);

  const registerMessageHeader = useCallback(
    (messageId: string, header: HTMLButtonElement | null): void => {
      if (header === null) {
        messageHeaderRefs.current.delete(messageId);
        return;
      }

      messageHeaderRefs.current.set(messageId, header);
    },
    []
  );

  const openAndFocusMessage = useCallback(
    (messageId: string): void => {
      openMessage(messageId);
      requestAnimationFrame(() => {
        const header = messageHeaderRefs.current.get(messageId);
        const article = header?.closest("article");
        if (header === undefined || article === undefined || article === null) {
          return;
        }

        header.focus({ preventScroll: true });
        article.scrollIntoView({ behavior: "instant", block: "start" });
      });
    },
    [openMessage]
  );

  const moveSelection = useCallback(
    (direction: MessageSelectionDirection): void => {
      const nextMessageId = getAdjacentMessageId(
        messageIds,
        selectedMessageId,
        direction
      );

      if (
        nextMessageId === null ||
        (nextMessageId === selectedMessageId &&
          expandedMessageId === selectedMessageId)
      ) {
        return;
      }

      openAndFocusMessage(nextMessageId);
    },
    [expandedMessageId, messageIds, openAndFocusMessage, selectedMessageId]
  );

  useAppCommand("thread.nextMessage", () => moveSelection(1), {
    enabled: messageIds.length > 0,
  });
  useAppCommand("thread.previousMessage", () => moveSelection(-1), {
    enabled: messageIds.length > 0,
  });

  const focusSelectedMessage = useCallback(
    (): void => focusMessage(selectedMessageId),
    [focusMessage, selectedMessageId]
  );

  return {
    focusSelectedMessage,
    registerMessageHeader,
    selectedMessageId,
  };
};
