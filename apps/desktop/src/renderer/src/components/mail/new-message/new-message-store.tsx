import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import {
  createNewMailDraft,
  toMailDraftComposerValue,
} from "@/mail/mail-draft";
import { EMPTY_EMAIL_SIGNATURE_BODY } from "@/shared/email-signature";
import type { EmailSignatureBody } from "@/shared/email-signature";
import { truncateGmailSubject } from "@/shared/gmail-subject";
import type { MailDraft, MailDraftSignature } from "@/shared/ipc/mail";

export const EMPTY_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

interface NewMessageState {
  accountId: string;
  cleanHistory: readonly CleanDraftVersion[];
  composer: EmailComposerValue;
  draftId: string;
  isSending: boolean;
  recipientResetVersion: number;
  recipients: EmailRecipients;
  selectedCleanVersionId: string | null;
  signature?: MailDraftSignature;
  stashes: readonly MailDraft[];
  subject: string;
  incrementRecipientResetVersion: () => void;
  setAccountId: (accountId: string) => void;
  resetCleanHistory: () => void;
  setCleanHistory: (history: readonly CleanDraftVersion[]) => void;
  setComposer: (composer: EmailComposerValue) => void;
  setDraftId: (draftId: string) => void;
  setIsSending: (isSending: boolean) => void;
  setRecipients: (recipients: EmailRecipients) => void;
  setSelectedCleanVersionId: (versionId: string | null) => void;
  setSignature: (signature?: MailDraftSignature) => void;
  setStashes: (stashes: readonly MailDraft[]) => void;
  setSubject: (subject: string) => void;
  updateStashes: (
    update: (stashes: readonly MailDraft[]) => readonly MailDraft[]
  ) => void;
}

export type NewMessageStore = ReturnType<typeof createNewMessageStore>;

export const createNewMessageStore = (
  accountId: string,
  emailSignature: EmailSignatureBody = EMPTY_EMAIL_SIGNATURE_BODY
) => {
  const initialDraft = createNewMailDraft(
    accountId.length === 0 ? undefined : accountId,
    emailSignature
  );

  return createStore<NewMessageState>()((set) => ({
    accountId,
    cleanHistory: [],
    composer: toMailDraftComposerValue(initialDraft),
    draftId: initialDraft.id,
    incrementRecipientResetVersion: () =>
      set((state) => ({
        recipientResetVersion: state.recipientResetVersion + 1,
      })),
    isSending: false,
    recipientResetVersion: 0,
    recipients: EMPTY_RECIPIENTS,
    resetCleanHistory: () =>
      set({ cleanHistory: [], selectedCleanVersionId: null }),
    selectedCleanVersionId: null,
    setAccountId: (nextAccountId) => set({ accountId: nextAccountId }),
    setCleanHistory: (cleanHistory) => set({ cleanHistory }),
    setComposer: (composer) => set({ composer }),
    setDraftId: (draftId) => set({ draftId }),
    setIsSending: (isSending) => set({ isSending }),
    setRecipients: (recipients) => set({ recipients }),
    setSelectedCleanVersionId: (selectedCleanVersionId) =>
      set({ selectedCleanVersionId }),
    setSignature: (signature) => set({ signature }),
    setStashes: (stashes) => set({ stashes }),
    setSubject: (subject) => set({ subject: truncateGmailSubject(subject) }),
    signature: initialDraft.signature,
    stashes: [],
    subject: "",
    updateStashes: (update) =>
      set((state) => ({ stashes: update(state.stashes) })),
  }));
};

const NewMessageStoreContext = createContext<NewMessageStore | null>(null);

export const NewMessageStoreProvider = ({
  children,
  store,
}: {
  children: ReactNode;
  store: NewMessageStore;
}) => <NewMessageStoreContext value={store}>{children}</NewMessageStoreContext>;

const useNewMessageStoreContext = (): NewMessageStore => {
  const store = useContext(NewMessageStoreContext);
  if (store === null) {
    throw new Error("NewMessageStoreProvider is missing");
  }
  return store;
};

export const useNewMessageStore = <Value,>(
  selector: (state: NewMessageState) => Value
): Value => useStore(useNewMessageStoreContext(), selector);

export const useNewMessageStoreApi = useNewMessageStoreContext;
