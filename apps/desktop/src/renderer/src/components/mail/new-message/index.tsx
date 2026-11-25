import { useBlocker } from "@tanstack/react-router";
import { useEffect, useId, useRef } from "react";

import { NewMessagePageShell } from "@/components/mail/new-message-shell";
import { useInstanceValue } from "@/hooks/use-instance-value";
import { useAppCommand } from "@/hotkeys";
import { getInitialComposerAccountId } from "@/mail/composer-account";
import { getDraftResumeFocusTarget } from "@/mail/mail-draft";
import type { Account } from "@/shared/ipc/accounts";
import type { ScheduledMailEditSession } from "@/shared/ipc/scheduled-mail";
import { useAccountSettings } from "@/state/account-settings";

import NewMessageForm from "./new-message-form";
import {
  createNewMessageStore,
  NewMessageStoreProvider,
} from "./new-message-store";
import NewMessageTitlebar from "./new-message-titlebar";
import { useNewMessageWorkspace } from "./use-new-message-workspace";

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

interface NewMessagePageProps {
  readonly accounts: readonly Account[];
  readonly initialAccountId: string | null;
  /**
   * Leaves the page once the composer has sent, stashed, discarded, saved
   * and closed, or found its draft empty.
   */
  readonly onClose: () => void;
  /** A scheduled email's editor takes each saved revision of its session. */
  readonly onScheduledEditChange?: (session: ScheduledMailEditSession) => void;
  /** Opens the page as the editor of this scheduled email. */
  readonly scheduledEdit?: ScheduledMailEditSession;
}

const NewMessagePageContent = ({
  accounts,
  onClose,
  onScheduledEditChange,
  scheduledEdit,
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
    onScheduledEditChange,
    scheduledEdit,
  });

  const { getElement } = workspace.focus;
  const handleAccountSelect = workspace.selectAccount;
  const handleClean = workspace.cleanDraft;
  const handleComposerChange = workspace.updateComposer;
  const handleDismissCleanVersion = workspace.dismissCleanVersion;
  const handleFiles = workspace.outgoingAttachments.addAttachments;
  const handleSelectCleanVersion = workspace.selectCleanVersion;
  const handleSend = workspace.send;
  const handleSubjectChange = workspace.updateSubject;
  const { prepareToLeave } = workspace;

  const initialFocusTarget = useInstanceValue(() =>
    scheduledEdit === undefined
      ? "to"
      : getDraftResumeFocusTarget(scheduledEdit.draft)
  );

  // Every way off the page, whether a sidebar row, a shortcut, Go back, or
  // another page's button, waits here: a new email until anything written is
  // in Stash, a scheduled email until unsaved edits are saved or abandoned. A
  // busy composer, a failed save, or Keep editing keeps the page on screen.
  useBlocker({
    enableBeforeUnload: false,
    shouldBlockFn: async () =>
      !(isReleasedRef.current || (await prepareToLeave())),
  });

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      getElement(initialFocusTarget)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [getElement, initialFocusTarget]);

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
  // A scheduled email's Discard deletes it for good; its titlebar button
  // owns `Mod+D` there.
  useAppCommand(
    "composer.discard",
    () => {
      void workspace.discard();
    },
    { enabled: !(workspace.isBusy || workspace.scheduled.isEdit) }
  );

  return (
    <NewMessagePageShell labelledBy={titleId} onFiles={handleFiles}>
      <NewMessageTitlebar
        accountsCount={accounts.length}
        titleId={titleId}
        workspace={workspace}
      />
      <NewMessageForm
        accounts={accounts}
        applyTemplate={workspace.applyTemplate}
        canClean={workspace.canClean}
        cleanupModelLabel={workspace.cleanupModelLabel}
        focus={workspace.focus}
        onAccountSelect={handleAccountSelect}
        onClean={handleClean}
        onComposerChange={handleComposerChange}
        onDismissCleanVersion={handleDismissCleanVersion}
        onSelectCleanVersion={handleSelectCleanVersion}
        onSend={handleSend}
        onSubjectChange={handleSubjectChange}
        outgoingAttachments={workspace.outgoingAttachments}
        scheduled={workspace.scheduled}
        selectedAccountId={workspace.selectedAccountId}
        templates={workspace.templates}
      />
    </NewMessagePageShell>
  );
};

/**
 * An email written on its own page in the content column: a new email, or
 * with `scheduledEdit`, a scheduled email opened from Scheduled. Leaving a
 * new email any way but Send or Discard keeps what was written in Stash;
 * leaving a scheduled email asks before abandoning unsaved edits.
 */
export const NewMessagePage = ({
  initialAccountId,
  ...props
}: NewMessagePageProps) => (
  <NewMessageStoreScope
    accounts={props.accounts}
    initialAccountId={initialAccountId}
    scheduledEdit={props.scheduledEdit}
  >
    <NewMessagePageContent {...props} />
  </NewMessageStoreScope>
);
