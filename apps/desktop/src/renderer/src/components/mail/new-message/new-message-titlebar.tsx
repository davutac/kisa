import { ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import NewMessageStashPicker from "@/components/mail/new-message-stash-picker";
import { PageTitlebar } from "@/components/shell/page-titlebar";
import { Button } from "@/components/ui/button";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { getScheduledDueCheckDelay } from "@/scheduled/schedule-time";
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
 * Whether a scheduled email's send time has passed while its editor is open.
 * The worker still delivers it, so the editor only says so.
 */
const useIsScheduledSendOverdue = (scheduledAt: number | undefined) => {
  const [isOverdue, setIsOverdue] = useState(
    () => scheduledAt !== undefined && scheduledAt <= Date.now()
  );

  useEffect(() => {
    if (scheduledAt === undefined) {
      return;
    }

    let timeout: number | undefined;

    const checkDueTime = (): void => {
      const delay = getScheduledDueCheckDelay(scheduledAt, Date.now());
      // A reschedule moves the time forward again, so this also clears.
      setIsOverdue(delay === 0);

      if (delay > 0) {
        timeout = window.setTimeout(checkDueTime, delay);
      }
    };

    checkDueTime();

    return () => {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [scheduledAt]);

  return scheduledAt !== undefined && isOverdue;
};

/**
 * A scheduled email's title, a breadcrumb like a conversation's over the
 * mailbox: Scheduled leaves the editor as Escape does, then the subject.
 */
const ScheduledEmailTitle = ({
  disabled,
  onBack,
}: {
  readonly disabled: boolean;
  readonly onBack: () => void;
}) => {
  const subject = useNewMessageStore((state) => state.subject.trim());
  const closeDisplay = getHotkeyDisplay("composer.close");

  return (
    <>
      <Button
        aria-keyshortcuts={getHotkeyAriaLabel("composer.close")}
        aria-label="Back to Scheduled"
        className="app-titlebar-interactive text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 h-auto rounded-sm border-0 p-0 text-[length:inherit] leading-[inherit] transition-colors hover:no-underline active:not-aria-[haspopup]:translate-y-0 data-disabled:opacity-100"
        disabled={disabled}
        onClick={onBack}
        title={`Back to Scheduled (${closeDisplay.bindings[0]})`}
        type="button"
        variant="link"
      >
        Scheduled
      </Button>
      <ChevronRightIcon
        aria-hidden="true"
        className="text-muted-foreground mx-1 inline size-3.5 align-[-2px]"
      />
      {subject.length > 0 ? subject : "Scheduled email"}
    </>
  );
};

/**
 * The composer page's title and actions, set in the content titlebar so the
 * page itself holds only the email. A new email offers Stash, the stash
 * picker (where each stash can also be discarded), Send, and Schedule;
 * Escape or leaving the page any other way keeps what was written in Stash,
 * and `Mod+D` discards it. A scheduled email offers Discard, Save, Send now,
 * and Reschedule instead, and says when its send time passes while open.
 */
const NewMessageTitlebar = ({
  accountsCount,
  titleId,
  workspace,
}: NewMessageTitlebarProps) => {
  const draftId = useNewMessageStore((state) => state.draftId);
  const isSending = useNewMessageStore((state) => state.isSending);
  const isScheduling = useNewMessageStore((state) => state.isScheduling);
  const recipients = useNewMessageStore((state) => state.recipients);
  const subject = useNewMessageStore((state) => state.subject);
  const { isEdit, scheduledAt } = workspace.scheduled;
  const isOverdue = useIsScheduledSendOverdue(isEdit ? scheduledAt : undefined);
  const [sendBinding] = workspace.sendDisplay.bindings;

  const handleDiscardStash = (draft: MailDraft): void => {
    void workspace.discardStash(draft);
  };

  const handleSelectDraft = workspace.switchDraft;
  const handleSend = workspace.send;
  const handleStash = workspace.stashCurrentDraft;

  return (
    <PageTitlebar
      title={
        isEdit ? (
          <ScheduledEmailTitle
            disabled={workspace.isBusy}
            onBack={() => {
              void workspace.leave();
            }}
          />
        ) : (
          "New email"
        )
      }
      titleId={titleId}
    >
      {isEdit ? (
        <output
          aria-atomic="true"
          aria-live="polite"
          className="text-muted-foreground px-1.5 text-xs whitespace-nowrap"
          title={
            isOverdue
              ? "Send time passed while you were editing. It will send when you save or close."
              : undefined
          }
        >
          {isOverdue ? (
            <>
              Send time passed
              <span className="sr-only">
                {" "}
                while you were editing. It will send when you save or close.
              </span>
            </>
          ) : null}
        </output>
      ) : null}
      <NewMessageFooter
        canSend={workspace.canSend}
        canStash={workspace.canStash}
        delivery={{ recipients, subject }}
        isScheduling={isScheduling}
        isSending={isSending}
        key={draftId}
        onSend={handleSend}
        onStash={handleStash}
        scheduled={workspace.scheduled}
        sendShortcutLabel={`${workspace.sendDisplay.label} (${sendBinding})`}
        stashPicker={
          !isEdit && workspace.availableStashes.length > 0 ? (
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
