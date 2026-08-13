// The scoped store intentionally lives for one keyed composer instance.
// oxlint-disable react/react-compiler
import { useMemo } from "react";

import NewMessageDialogShell from "@/components/mail/new-message-dialog-shell";
import { Dialog } from "@/components/ui/dialog";
import { getInitialComposerAccountId } from "@/mail/composer-account";
import type { GoogleAccount } from "@/shared/ipc/auth";

import NewMessageForm from "./new-message-form";
import NewMessageHeader from "./new-message-header";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
  useNewMessageStore,
} from "./new-message-store";
import { useNewMessageWorkspace } from "./use-new-message-workspace";

interface NewMessageDialogProps {
  accounts: readonly GoogleAccount[];
  initialAccountId: string | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const NewMessageDialogContent = ({
  accounts,
  isOpen,
  onOpenChange,
}: Omit<NewMessageDialogProps, "initialAccountId">) => {
  const isSending = useNewMessageStore((state) => state.isSending);
  const workspace = useNewMessageWorkspace({ accounts, isOpen, onOpenChange });
  const [sendBinding] = workspace.sendDisplay.bindings;
  const handleClean = workspace.cleanDraft;
  const handleFiles = workspace.addAttachments;
  const handleSelectDraft = workspace.switchDraft;
  const handleSend = workspace.send;
  const handleStash = workspace.stashCurrentDraft;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isSending) {
          onOpenChange(false);
        }
      }}
      open={isOpen}
    >
      <NewMessageDialogShell
        initialFocus={() => workspace.focus.getElement("to")}
        onFiles={handleFiles}
      >
        <NewMessageHeader
          accountsCount={accounts.length}
          drafts={workspace.availableStashes}
          getReturnFocus={workspace.focus.getReturnElement}
          isCleaning={workspace.isCleaning}
          onSelectDraft={handleSelectDraft}
          stashPickerTriggerRef={workspace.stashPickerTriggerRef}
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
          isCleaning={workspace.isCleaning}
          onClean={handleClean}
          onSend={handleSend}
          onStash={handleStash}
          selectedAccountId={workspace.selectedAccountId}
          sendShortcutLabel={`${workspace.sendDisplay.label} (${sendBinding})`}
          setAttachments={workspace.setAttachments}
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
}: NewMessageDialogProps) => {
  const store = useMemo(
    () =>
      createNewMessageStore(
        getInitialComposerAccountId(accounts, initialAccountId)
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
      />
    </NewMessageStoreProvider>
  );
};

export default NewMessageDialog;
