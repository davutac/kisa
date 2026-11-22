import { useBlocker } from "@tanstack/react-router";
import { useEffect, useId, useRef } from "react";

import {
  NewMessageDialogShell,
  NewMessagePageShell,
} from "@/components/mail/new-message-shell";
import { Dialog } from "@/components/ui/dialog";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useAppCommand } from "@/hotkeys";
import { getInitialComposerAccountId } from "@/mail/composer-account";
import { getDraftResumeFocusTarget } from "@/mail/mail-draft";
import type { Account } from "@/shared/ipc/accounts";
import type { MailDraft } from "@/shared/ipc/mail";
import type { ScheduledMailEditSession } from "@/shared/ipc/scheduled-mail";
import { useAccountSettings } from "@/state/account-settings";

import NewMessageForm from "./new-message-form";
import NewMessageHeader from "./new-message-header";
import type { NewMessageLayout } from "./new-message-layout";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "./new-message-store";
import NewMessageTitlebar from "./new-message-titlebar";
import { useNewMessageWorkspace } from "./use-new-message-workspace";

type NewMessageWorkspace = ReturnType<typeof useNewMessageWorkspace>;

const NewMessageWorkspaceForm = ({
  accounts,
  layout,
  workspace,
}: {
  readonly accounts: readonly Account[];
  readonly layout: NewMessageLayout;
  readonly workspace: NewMessageWorkspace;
}) => {
  const [sendBinding] = workspace.sendDisplay.bindings;
  const handleAccountSelect = workspace.selectAccount;
  const handleClean = workspace.cleanDraft;
  const handleComposerChange = workspace.updateComposer;
  const handleDismissCleanVersion = workspace.dismissCleanVersion;
  const handleSelectCleanVersion = workspace.selectCleanVersion;
  const handleSend = workspace.send;
  const handleStash = workspace.stashCurrentDraft;
  const handleSubjectChange = workspace.updateSubject;

  return (
    <NewMessageForm
      accounts={accounts}
      applyTemplate={workspace.applyTemplate}
      canClean={workspace.canClean}
      canSend={workspace.canSend}
      canStash={workspace.canStash}
      cleanupModelLabel={workspace.cleanupModelLabel}
      focus={workspace.focus}
      layout={layout}
      onClean={handleClean}
      onAccountSelect={handleAccountSelect}
      onComposerChange={handleComposerChange}
      onDismissCleanVersion={handleDismissCleanVersion}
      onSelectCleanVersion={handleSelectCleanVersion}
      onSend={handleSend}
      onStash={handleStash}
      onSubjectChange={handleSubjectChange}
      outgoingAttachments={workspace.outgoingAttachments}
      selectedAccountId={workspace.selectedAccountId}
      sendShortcutLabel={`${workspace.sendDisplay.label} (${sendBinding})`}
      scheduled={workspace.scheduled}
      templates={workspace.templates}
    />
  );
};

/** One store per opened composer, seeded with the account and signature. */
const NewMessageStoreScope = ({
  accounts,
  children,
  initialAccountId,
  scheduledEdit,
}: {
  readonly accounts: readonly Account[];
  readonly children: React.ReactNode;
  readonly initialAccountId: string | null;
  readonly scheduledEdit?: ScheduledMailEditSession;
}) => {
  const initialComposerAccountId = getInitialComposerAccountId(
    accounts,
    scheduledEdit?.draft.accountId ?? initialAccountId
  );
  const { emailSignature } = useAccountSettings(initialComposerAccountId);
  // The parent keys each newly opened composer. Account changes while that
  // composer is open must not replace its draft store.
  const store = useInstanceValue(() =>
    createNewMessageStore(
      initialComposerAccountId,
      emailSignature,
      scheduledEdit?.draft
    )
  );

  return (
    <NewMessageStoreProvider store={store}>{children}</NewMessageStoreProvider>
  );
};

interface NewMessageDialogProps {
  accounts: readonly Account[];
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
  const handleFiles = workspace.outgoingAttachments.addAttachments;
  const handleDiscardDraft = (draft: MailDraft): void => {
    void workspace.discardStash(draft);
  };
  const handleSelectDraft = workspace.switchDraft;

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
          onDiscardDraft={handleDiscardDraft}
          onSelectDraft={handleSelectDraft}
          stashPickerTriggerRef={workspace.stashPickerTriggerRef}
          scheduledEdit={scheduledEdit}
        />
        <NewMessageWorkspaceForm
          accounts={accounts}
          layout="dialog"
          workspace={workspace}
        />
      </NewMessageDialogShell>
    </Dialog>
  );
};

/**
 * The composer as a dialog. Editing a scheduled email opens it over the
 * Scheduled list; a new email opens as `NewMessagePage`, its own page.
 */
const NewMessageDialog = ({
  initialAccountId,
  ...props
}: NewMessageDialogProps) => (
  <NewMessageStoreScope
    accounts={props.accounts}
    initialAccountId={initialAccountId}
    scheduledEdit={props.scheduledEdit}
  >
    <NewMessageDialogContent {...props} />
  </NewMessageStoreScope>
);

interface NewMessagePageProps {
  readonly accounts: readonly Account[];
  readonly initialAccountId: string | null;
  /**
   * Leaves the page once the composer has sent, stashed, or discarded its
   * draft, or found it empty.
   */
  readonly onClose: () => void;
}

const NewMessagePageContent = ({
  accounts,
  onClose,
}: Omit<NewMessagePageProps, "initialAccountId">) => {
  const titleId = useId();
  // Set once the composer has finished with its draft itself, so the
  // navigation that closes the page is not held up to keep it again.
  const isReleasedRef = useRef(false);
  const workspace = useNewMessageWorkspace({
    accounts,
    isOpen: true,
    onOpenChange: (open) => {
      if (!open) {
        isReleasedRef.current = true;
        onClose();
      }
    },
  });
  const { getElement } = workspace.focus;
  const handleFiles = workspace.outgoingAttachments.addAttachments;
  const { keepDraftForLeaving } = workspace;

  // Every way off the page, whether a sidebar row, a shortcut, Go back, or
  // another page's button, waits here until anything written is in Stash. A
  // busy composer or a failed save keeps the page, and the draft, on screen.
  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: async () =>
      !(isReleasedRef.current || (await keepDraftForLeaving())),
  });

  // The dialog used to place focus; on its page, the composer does it on opening.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      getElement("to")?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [getElement]);

  // Escape in an open menu, picker, or slash menu closes only that popup:
  // TanStack yields Escape to ARIA popups, and the registry skips a key the
  // editor already handled.
  useAppCommand(
    "composer.close",
    () => {
      void workspace.leave();
    },
    {
      enabled: !workspace.isBusy,
    }
  );
  useAppCommand(
    "composer.discard",
    () => {
      void workspace.discard();
    },
    { enabled: !workspace.isBusy }
  );

  return (
    <NewMessagePageShell labelledBy={titleId} onFiles={handleFiles}>
      <NewMessageTitlebar
        accountsCount={accounts.length}
        titleId={titleId}
        workspace={workspace}
      />
      <NewMessageWorkspaceForm
        accounts={accounts}
        layout="page"
        workspace={workspace}
      />
    </NewMessagePageShell>
  );
};

/**
 * A new email, written on its own page in the content column. Leaving it any
 * way but Send or Discard keeps what was written in Stash.
 */
export const NewMessagePage = ({
  initialAccountId,
  ...props
}: NewMessagePageProps) => (
  <NewMessageStoreScope
    accounts={props.accounts}
    initialAccountId={initialAccountId}
  >
    <NewMessagePageContent {...props} />
  </NewMessageStoreScope>
);

export default NewMessageDialog;
