import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { EmailComposerValue } from "@/components/mail/email-composer";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import type { MailDraft } from "@/shared/ipc/mail";

export const EMPTY_COMPOSER_VALUE: EmailComposerValue = {
  html: "",
  isEmpty: true,
  text: "",
};

export const EMPTY_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

interface NewMessageState {
  accountId: string;
  composer: EmailComposerValue;
  draftId: string;
  isSending: boolean;
  recipientResetVersion: number;
  recipients: EmailRecipients;
  stashes: readonly MailDraft[];
  subject: string;
  incrementRecipientResetVersion: () => void;
  setAccountId: (accountId: string) => void;
  setComposer: (composer: EmailComposerValue) => void;
  setDraftId: (draftId: string) => void;
  setIsSending: (isSending: boolean) => void;
  setRecipients: (recipients: EmailRecipients) => void;
  setStashes: (stashes: readonly MailDraft[]) => void;
  setSubject: (subject: string) => void;
  updateStashes: (
    update: (stashes: readonly MailDraft[]) => readonly MailDraft[]
  ) => void;
}

export type NewMessageStore = ReturnType<typeof createNewMessageStore>;

export const createNewMessageStore = (accountId: string) =>
  createStore<NewMessageState>()((set) => ({
    accountId,
    composer: EMPTY_COMPOSER_VALUE,
    draftId: crypto.randomUUID(),
    incrementRecipientResetVersion: () =>
      set((state) => ({
        recipientResetVersion: state.recipientResetVersion + 1,
      })),
    isSending: false,
    recipientResetVersion: 0,
    recipients: EMPTY_RECIPIENTS,
    setAccountId: (nextAccountId) => set({ accountId: nextAccountId }),
    setComposer: (composer) => set({ composer }),
    setDraftId: (draftId) => set({ draftId }),
    setIsSending: (isSending) => set({ isSending }),
    setRecipients: (recipients) => set({ recipients }),
    setStashes: (stashes) => set({ stashes }),
    setSubject: (subject) => set({ subject }),
    stashes: [],
    subject: "",
    updateStashes: (update) =>
      set((state) => ({ stashes: update(state.stashes) })),
  }));

const NewMessageStoreContext = createContext<NewMessageStore | null>(null);

export const NewMessageStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: NewMessageStore;
}) => <NewMessageStoreContext value={store}>{children}</NewMessageStoreContext>;

export const useNewMessageStore = <Value,>(
  selector: (state: NewMessageState) => Value
): Value => {
  const store = useContext(NewMessageStoreContext);
  if (store === null) {
    throw new Error("NewMessageStoreProvider is missing");
  }
  return useStore(store, selector);
};
