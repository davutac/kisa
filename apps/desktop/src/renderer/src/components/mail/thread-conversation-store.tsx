import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

interface ThreadConversationState {
  // Several messages may be open at once; the selected one is the target of
  // reply, forward, and message navigation, open or not.
  expandedMessageIds: ReadonlySet<string>;
  selectedMessageId: string;
  openMessage: (messageId: string) => void;
  reconcileMessages: (messageIds: readonly string[]) => void;
  selectMessage: (messageId: string) => void;
  toggleMessage: (messageId: string) => void;
}

const withMessage = (
  messageIds: ReadonlySet<string>,
  messageId: string
): ReadonlySet<string> =>
  messageIds.has(messageId) ? messageIds : new Set([...messageIds, messageId]);

export const createThreadConversationStore = (initialMessageId: string) =>
  createStore<ThreadConversationState>()((set) => ({
    expandedMessageIds: new Set([initialMessageId]),
    openMessage: (messageId) => {
      set((state) => ({
        expandedMessageIds: withMessage(state.expandedMessageIds, messageId),
        selectedMessageId: messageId,
      }));
    },
    reconcileMessages: (messageIds) => {
      set((state) => {
        const expandedMessageIds = new Set(
          [...state.expandedMessageIds].filter((messageId) =>
            messageIds.includes(messageId)
          )
        );

        const expandedChanged =
          expandedMessageIds.size !== state.expandedMessageIds.size;

        if (messageIds.includes(state.selectedMessageId)) {
          return expandedChanged ? { expandedMessageIds } : state;
        }

        const fallbackMessageId = messageIds.at(-1);

        if (fallbackMessageId === undefined) {
          return expandedChanged ? { expandedMessageIds } : state;
        }

        return {
          expandedMessageIds: withMessage(
            expandedMessageIds,
            fallbackMessageId
          ),
          selectedMessageId: fallbackMessageId,
        };
      });
    },
    selectMessage: (messageId) => {
      set((state) =>
        state.selectedMessageId === messageId
          ? state
          : { selectedMessageId: messageId }
      );
    },
    selectedMessageId: initialMessageId,
    toggleMessage: (messageId) => {
      set((state) => {
        const expandedMessageIds = new Set(state.expandedMessageIds);

        if (!expandedMessageIds.delete(messageId)) {
          expandedMessageIds.add(messageId);
        }

        return { expandedMessageIds, selectedMessageId: messageId };
      });
    },
  }));

export type ThreadConversationStore = ReturnType<
  typeof createThreadConversationStore
>;

const ThreadConversationStoreContext =
  createContext<ThreadConversationStore | null>(null);

export const ThreadConversationStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: ThreadConversationStore;
}) => (
  <ThreadConversationStoreContext value={store}>
    {children}
  </ThreadConversationStoreContext>
);

export const useThreadConversationStore = <Value,>(
  selector: (state: ThreadConversationState) => Value
): Value => {
  const store = useContext(ThreadConversationStoreContext);

  if (store === null) {
    throw new Error("ThreadConversationStoreProvider is missing");
  }

  return useStore(store, selector);
};
