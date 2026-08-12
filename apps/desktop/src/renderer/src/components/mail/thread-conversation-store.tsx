import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

interface ThreadConversationState {
  expandedMessageId: string | null;
  selectedMessageId: string;
  openMessage: (messageId: string) => void;
  reconcileMessages: (messageIds: readonly string[]) => void;
  toggleMessage: (messageId: string) => void;
}

export const createThreadConversationStore = (initialMessageId: string) =>
  createStore<ThreadConversationState>()((set) => ({
    expandedMessageId: initialMessageId,
    openMessage: (messageId) => {
      set({ expandedMessageId: messageId, selectedMessageId: messageId });
    },
    reconcileMessages: (messageIds) => {
      set((state) => {
        if (messageIds.includes(state.selectedMessageId)) {
          return state;
        }

        const fallbackMessageId = messageIds.at(-1);
        return fallbackMessageId === undefined
          ? state
          : {
              expandedMessageId: fallbackMessageId,
              selectedMessageId: fallbackMessageId,
            };
      });
    },
    selectedMessageId: initialMessageId,
    toggleMessage: (messageId) => {
      set((state) => {
        if (state.selectedMessageId !== messageId) {
          return {
            expandedMessageId: messageId,
            selectedMessageId: messageId,
          };
        }

        return {
          expandedMessageId:
            state.expandedMessageId === messageId ? null : messageId,
        };
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
