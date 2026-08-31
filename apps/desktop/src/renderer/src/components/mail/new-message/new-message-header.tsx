import { useEffect, useState } from "react";
import type { RefObject } from "react";

import NewMessageStashPicker from "@/components/mail/new-message-stash-picker";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getScheduledDueCheckDelay } from "@/scheduled/schedule-time";
import type { MailDraft } from "@/shared/ipc/mail";
import type { ScheduledMailEditSession } from "@/shared/ipc/scheduled-mail";

import { useNewMessageStore } from "./new-message-store";

interface NewMessageHeaderProps {
  accountsCount: number;
  drafts: readonly MailDraft[];
  isCleaning: boolean;
  getReturnFocus: () => HTMLElement | null;
  onSelectDraft: (draft: MailDraft) => void;
  stashPickerTriggerRef: RefObject<HTMLButtonElement | null>;
  scheduledEdit?: ScheduledMailEditSession;
}

const NewMessageHeader = ({
  accountsCount,
  drafts,
  isCleaning,
  getReturnFocus,
  onSelectDraft,
  stashPickerTriggerRef,
  scheduledEdit,
}: NewMessageHeaderProps) => {
  const isSending = useNewMessageStore((state) => state.isSending);
  const isScheduling = useNewMessageStore((state) => state.isScheduling);
  const [isOverdue, setIsOverdue] = useState(
    () =>
      scheduledEdit !== undefined &&
      scheduledEdit.item.scheduledAt <= Date.now()
  );

  useEffect(() => {
    if (scheduledEdit === undefined) {
      return;
    }
    let timeout: number | undefined;
    const checkDueTime = (): void => {
      const delay = getScheduledDueCheckDelay(
        scheduledEdit.item.scheduledAt,
        Date.now()
      );
      if (delay === 0) {
        setIsOverdue(true);
        return;
      }
      timeout = window.setTimeout(checkDueTime, delay);
    };
    checkDueTime();
    return () => {
      if (timeout !== undefined) {
        window.clearTimeout(timeout);
      }
    };
  }, [scheduledEdit]);

  return (
    <DialogHeader className="shrink-0 px-4 py-3 pr-12">
      <div className="flex items-center justify-between gap-3">
        <DialogTitle className="shrink-0">
          {scheduledEdit === undefined ? "New email" : "Scheduled email"}
        </DialogTitle>
        <div className="flex h-7 w-24 shrink-0 justify-end">
          {scheduledEdit === undefined && drafts.length > 0 ? (
            <NewMessageStashPicker
              accountsCount={accountsCount}
              disabled={isCleaning || isSending || isScheduling}
              drafts={drafts}
              getReturnFocus={getReturnFocus}
              onSelect={onSelectDraft}
              triggerRef={stashPickerTriggerRef}
            />
          ) : null}
        </div>
      </div>
      {scheduledEdit === undefined ? (
        <DialogDescription className="sr-only">
          Write, stash, or send a new email message
        </DialogDescription>
      ) : (
        <>
          <DialogDescription className="sr-only">
            Edit, reschedule, or send this scheduled email
          </DialogDescription>
          <p
            aria-atomic="true"
            aria-live="polite"
            className={isOverdue ? undefined : "sr-only"}
          >
            {isOverdue
              ? "Send time passed while you were editing. It will send when you save or close."
              : ""}
          </p>
        </>
      )}
    </DialogHeader>
  );
};

export default NewMessageHeader;
