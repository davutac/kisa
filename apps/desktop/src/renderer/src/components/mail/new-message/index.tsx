// The scoped store intentionally lives for one keyed composer instance.
// oxlint-disable react/react-compiler
import { useMemo } from "react";

import NewMessageDialogShell from "@/components/mail/new-message-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { getInitialComposerAccountId } from "@/mail/composer-account";
import { getDraftResumeFocusTarget } from "@/mail/mail-draft";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { ScheduledMailEditSession } from "@/shared/ipc/scheduled-mail";
import { useAccountSettings } from "@/state/account-settings";

import NewMessageForm from "./new-message-form";
import NewMessageHeader from "./new-message-header";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "./new-message-store";
import { useNewMessageWorkspace } from "./use-new-message-workspace";

interface NewMessageDialogProps {
  accounts: readonly GoogleAccount[];
  initialAccountId: string | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onScheduledEditChange?: (session: ScheduledMailEditSession) => void;
  scheduledEdit?: ScheduledMailEditSession;
}

const NewMessageDialogContent = ({
  accounts,
  isOpen,
  onOpenChange,
  onScheduledEditChange,
  scheduledEdit,
}: Omit<NewMessageDialogProps, "initialAccountId">) => {
  const workspace = useNewMessageWorkspace({
    accounts,
    isOpen,
    onOpenChange,
    onScheduledEditChange,
    scheduledEdit,
  });
  const [sendBinding] = workspace.sendDisplay.bindings;
  const handleClean = workspace.cleanDraft;
  const handleAccountSelect = workspace.selectAccount;
  const handleComposerChange = workspace.updateComposer;
  const handleDismissCleanVersion = workspace.dismissCleanVersion;
  const handleFiles = workspace.addAttachments;
  const handleSelectCleanVersion = workspace.selectCleanVersion;
  const handleSelectDraft = workspace.switchDraft;
  const handleSend = workspace.send;
  const handleStash = workspace.stashCurrentDraft;
  const handleSubjectChange = workspace.updateSubject;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          void workspace.requestClose();
        }
      }}
      open={isOpen}
    >
      <NewMessageDialogShell
        initialFocus={() =>
          workspace.focus.getElement(
            scheduledEdit === undefined
              ? "to"
              : getDraftResumeFocusTarget(scheduledEdit.draft)
          )
        }
        onFiles={handleFiles}
      >
        <NewMessageHeader
          accountsCount={accounts.length}
          drafts={workspace.availableStashes}
          getReturnFocus={workspace.focus.getReturnElement}
          isCleaning={workspace.isCleaning}
          onSelectDraft={handleSelectDraft}
          stashPickerTriggerRef={workspace.stashPickerTriggerRef}
          scheduledEdit={scheduledEdit}
        />
        <NewMessageForm
          accounts={accounts}
          addAttachments={workspace.addAttachments}
          applyTemplate={workspace.applyTemplate}
          attachments={workspace.attachments}
          canClean={workspace.canClean}
          canSend={workspace.canSend}
          canStash={workspace.canStash}
          cleanupModelLabel={workspace.cleanupModelLabel}
          focus={workspace.focus}
          inputRef={workspace.inputRef}
          onClean={handleClean}
          onAccountSelect={handleAccountSelect}
          onComposerChange={handleComposerChange}
          onDismissCleanVersion={handleDismissCleanVersion}
          onSelectCleanVersion={handleSelectCleanVersion}
          onSend={handleSend}
          onStash={handleStash}
          onSubjectChange={handleSubjectChange}
          selectedAccountId={workspace.selectedAccountId}
          sendShortcutLabel={`${workspace.sendDisplay.label} (${sendBinding})`}
          setAttachments={workspace.setAttachments}
          scheduled={workspace.scheduled}
          templates={workspace.templates}
        />
      </NewMessageDialogShell>
    </Dialog>
  );
};

const NewMessageDialog = ({
  accounts,
  initialAccountId,
  isOpen,
  onOpenChange,
  onScheduledEditChange,
  scheduledEdit,
}: NewMessageDialogProps) => {
  const initialComposerAccountId = getInitialComposerAccountId(
    accounts,
    scheduledEdit?.draft.accountId ?? initialAccountId
  );
  const { emailSignature } = useAccountSettings(initialComposerAccountId);
  const store = useMemo(
    () =>
      createNewMessageStore(
        initialComposerAccountId,
        emailSignature,
        scheduledEdit?.draft
      ),
    // The parent keys each newly opened composer. Account changes while that
    // composer is open must not replace its draft store.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <NewMessageStoreProvider store={store}>
      <NewMessageDialogContent
        accounts={accounts}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        onScheduledEditChange={onScheduledEditChange}
        scheduledEdit={scheduledEdit}
      />
    </NewMessageStoreProvider>
  );
};

export default NewMessageDialog;
