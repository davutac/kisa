import NewMessageStashPicker from "@/components/mail/new-message-stash-picker";
import { PageTitlebar } from "@/components/shell/page-titlebar";
import type { MailDraft } from "@/shared/ipc/mail";

import NewMessageFooter from "./new-message-footer";
import { useNewMessageStore } from "./new-message-store";
import type { useNewMessageWorkspace } from "./use-new-message-workspace";

interface NewMessageTitlebarProps {
  readonly accountsCount: number;
  readonly titleId: string;
  readonly workspace: ReturnType<typeof useNewMessageWorkspace>;
}

/**
 * The new-email page's title and actions, set in the content titlebar so
 * the page itself holds only the email: Stash, the stash picker (where each
 * stash can also be discarded), Send, and Schedule. Escape or leaving the
 * page any other way closes it, keeping what was written in Stash; `Mod+D`
 * discards it.
 */
const NewMessageTitlebar = ({
  accountsCount,
  titleId,
  workspace,
}: NewMessageTitlebarProps) => {
  const draftId = useNewMessageStore((state) => state.draftId);
  const isSending = useNewMessageStore((state) => state.isSending);
  const isScheduling = useNewMessageStore((state) => state.isScheduling);
  const [sendBinding] = workspace.sendDisplay.bindings;
  const handleDiscardStash = (draft: MailDraft): void => {
    void workspace.discardStash(draft);
  };
  const handleSelectDraft = workspace.switchDraft;
  const handleSend = workspace.send;
  const handleStash = workspace.stashCurrentDraft;

  return (
    <PageTitlebar title="New email" titleId={titleId}>
      <NewMessageFooter
        canSend={workspace.canSend}
        canStash={workspace.canStash}
        isScheduling={isScheduling}
        isSending={isSending}
        key={draftId}
        layout="page"
        onSend={handleSend}
        onStash={handleStash}
        scheduled={workspace.scheduled}
        sendShortcutLabel={`${workspace.sendDisplay.label} (${sendBinding})`}
        stashPicker={
          workspace.availableStashes.length > 0 ? (
            <NewMessageStashPicker
              accountsCount={accountsCount}
              disabled={workspace.isCleaning || isSending || isScheduling}
              drafts={workspace.availableStashes}
              getReturnFocus={workspace.focus.getReturnElement}
              onDiscard={handleDiscardStash}
              onSelect={handleSelectDraft}
              triggerRef={workspace.stashPickerTriggerRef}
            />
          ) : null
        }
      />
    </PageTitlebar>
  );
};

export default NewMessageTitlebar;
