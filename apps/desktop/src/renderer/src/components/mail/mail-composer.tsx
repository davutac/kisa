import type { ComponentProps, Ref, RefObject } from "react";

import AiComposerButton from "@/components/mail/ai-composer-button";
import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import CleanDraftHistoryStrip from "@/components/mail/clean-draft-history-strip";
import EmailComposer from "@/components/mail/email-composer";
import {
  OutgoingAttachmentButton,
  OutgoingAttachmentList,
} from "@/components/mail/outgoing-attachments";
import { ButtonGroup } from "@/components/ui/button-group";
import { useAppCommand } from "@/hotkeys";
import type { MailDraftAttachment } from "@/shared/ipc/mail";

type MailComposerAiAction = Omit<
  ComponentProps<typeof AiComposerButton>,
  "grouped"
>;

interface MailComposerAttachmentOptions {
  readonly command: "composer.attach" | "threadComposer.attach";
  readonly files: readonly MailDraftAttachment[];
  readonly focusRef?: Ref<HTMLButtonElement>;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onAdd: (files: FileList | null) => void;
  readonly onRemove: (attachmentId: string) => void;
}

interface MailComposerHistoryOptions {
  readonly onDismiss: (version: CleanDraftVersion) => void;
  readonly onSelect: (version: CleanDraftVersion) => void;
  readonly selectedVersionId: string | null;
  readonly versions: readonly CleanDraftVersion[];
}

interface MailComposerProps extends Omit<
  ComponentProps<typeof EmailComposer>,
  "toolbarActions" | "toolbarHeader"
> {
  readonly aiActionGroupLabel?: string;
  readonly aiActions?: readonly MailComposerAiAction[];
  readonly attachments?: MailComposerAttachmentOptions;
  readonly groupAiActions?: boolean;
  readonly history?: MailComposerHistoryOptions;
}

const NO_AI_ACTIONS: readonly MailComposerAiAction[] = [];

const MailComposer = ({
  aiActionGroupLabel = "AI composer actions",
  aiActions = NO_AI_ACTIONS,
  attachments,
  disabled = false,
  groupAiActions = false,
  history,
  ...composerProps
}: MailComposerProps) => {
  const attachmentCommand = attachments?.command ?? "composer.attach";
  useAppCommand(
    attachmentCommand,
    () => attachments?.inputRef.current?.click(),
    { enabled: attachments !== undefined && !disabled }
  );

  const aiButtons = aiActions.map((action) => (
    <AiComposerButton
      command={action.command}
      disabled={action.disabled}
      grouped={groupAiActions}
      icon={action.icon}
      isWorking={action.isWorking}
      key={action.command}
      label={action.label}
      modelLabel={action.modelLabel}
      onClick={() => action.onClick()}
      workingLabel={action.workingLabel}
    />
  ));
  const aiControls =
    groupAiActions && aiButtons.length > 0 ? (
      <ButtonGroup
        aria-label={aiActionGroupLabel}
        variant={
          aiActions.some(({ disabled: actionDisabled }) => !actionDisabled)
            ? "ai"
            : "default"
        }
      >
        {aiButtons}
      </ButtonGroup>
    ) : (
      aiButtons
    );

  return (
    <>
      <EmailComposer
        {...composerProps}
        disabled={disabled}
        toolbarActions={
          <>
            {aiControls}
            {attachments === undefined ? null : (
              <OutgoingAttachmentButton
                command={attachments.command}
                disabled={disabled}
                focusRef={attachments.focusRef}
                inputRef={attachments.inputRef}
                onFiles={(files) => attachments.onAdd(files)}
              />
            )}
          </>
        }
        toolbarHeader={
          history === undefined ? null : (
            <CleanDraftHistoryStrip
              disabled={disabled}
              onDismiss={(version) => history.onDismiss(version)}
              onSelect={(version) => history.onSelect(version)}
              selectedVersionId={history.selectedVersionId}
              versions={history.versions}
            />
          )
        }
      />
      {attachments === undefined ? null : (
        <OutgoingAttachmentList
          attachments={attachments.files}
          onRemove={(attachmentId) => attachments.onRemove(attachmentId)}
        />
      )}
    </>
  );
};

export default MailComposer;
