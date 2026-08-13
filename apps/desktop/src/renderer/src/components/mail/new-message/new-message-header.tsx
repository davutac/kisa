import type { RefObject } from "react";

import NewMessageStashPicker from "@/components/mail/new-message-stash-picker";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MailDraft } from "@/shared/ipc/mail";

import { useNewMessageStore } from "./new-message-store";

interface NewMessageHeaderProps {
  accountsCount: number;
  drafts: readonly MailDraft[];
  isCleaning: boolean;
  getReturnFocus: () => HTMLElement | null;
  onSelectDraft: (draft: MailDraft) => void;
  stashPickerTriggerRef: RefObject<HTMLButtonElement | null>;
}

const NewMessageHeader = ({
  accountsCount,
  drafts,
  isCleaning,
  getReturnFocus,
  onSelectDraft,
  stashPickerTriggerRef,
}: NewMessageHeaderProps) => {
  const isSending = useNewMessageStore((state) => state.isSending);

  return (
    <DialogHeader className="shrink-0 px-4 py-3 pr-12">
      <div className="flex items-center justify-between gap-3">
        <DialogTitle className="shrink-0">New email</DialogTitle>
        <div className="flex h-7 w-24 shrink-0 justify-end">
          {drafts.length > 0 ? (
            <NewMessageStashPicker
              accountsCount={accountsCount}
              disabled={isCleaning || isSending}
              drafts={drafts}
              getReturnFocus={getReturnFocus}
              onSelect={onSelectDraft}
              triggerRef={stashPickerTriggerRef}
            />
          ) : null}
        </div>
      </div>
      <DialogDescription className="sr-only">
        Write, stash, or send a new email message
      </DialogDescription>
    </DialogHeader>
  );
};

export default NewMessageHeader;
