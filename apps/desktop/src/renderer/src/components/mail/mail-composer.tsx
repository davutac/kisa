import { useCallback } from "react";
import type { ComponentProps, Ref } from "react";

import AiComposerButton from "@/components/mail/ai-composer-button";
import type { CleanDraftVersion } from "@/components/mail/clean-draft-history";
import CleanDraftHistoryStrip from "@/components/mail/clean-draft-history-strip";
import {
  collectComposerInlineContentIds,
  getRetainedComposerInlineBytes,
  partitionComposerFiles,
} from "@/components/mail/composer-inline-images";
import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import type { OutgoingAttachmentComposerController } from "@/components/mail/outgoing-attachments";
import {
  OutgoingAttachmentButton,
  OutgoingAttachmentList,
} from "@/components/mail/outgoing-attachments";
import { ButtonGroup } from "@/components/ui/button-group";
import { useAppCommand } from "@/hotkeys";
import type { ComposerTemplateInput } from "@/shared/ipc/templates";

type MailComposerAiAction = Omit<
  ComponentProps<typeof AiComposerButton>,
  "grouped"
>;

interface MailComposerAttachmentOptions {
  readonly command: "composer.attach" | "threadComposer.attach";
  readonly controller: OutgoingAttachmentComposerController;
  readonly focusRef?: Ref<HTMLButtonElement>;
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

const getDetachedInlineContentIds = (
  controller: OutgoingAttachmentComposerController,
  referencedContentIds: ReadonlySet<string>
): readonly string[] =>
  controller.attachments.flatMap(({ contentId }) =>
    contentId !== undefined && !referencedContentIds.has(contentId)
      ? [contentId]
      : []
  );

const useMailComposerAttachmentHandlers = (
  controller: OutgoingAttachmentComposerController | undefined,
  onApplyTemplate: MailComposerProps["onApplyTemplate"],
  onChange: MailComposerProps["onChange"]
) => {
  const addAttachments = controller?.addAttachments;
  const addInlineImages = controller?.addInlineImages;
  const fallbackInlineImagesToAttachments =
    controller?.fallbackInlineImagesToAttachments;
  const setReferencedInlineContentIds =
    controller?.setReferencedInlineContentIds;

  const handleComposerFiles = useCallback(
    async (files: readonly File[]) => {
      if (addAttachments === undefined || addInlineImages === undefined) {
        return [];
      }
      const existingInlineBytes = getRetainedComposerInlineBytes(
        controller?.attachments ?? []
      );
      const partitioned = partitionComposerFiles(files, existingInlineBytes);
      const inlineImages = await addInlineImages(partitioned.inlineImages);
      if (partitioned.attachments.length > 0) {
        void addAttachments(partitioned.attachments);
      }
      return inlineImages;
    },
    [addAttachments, addInlineImages, controller?.attachments]
  );

  const handleChange = useCallback(
    (value: EmailComposerValue) => {
      setReferencedInlineContentIds?.(
        collectComposerInlineContentIds(value.html)
      );
      onChange?.(value);
    },
    [onChange, setReferencedInlineContentIds]
  );

  const handleApplyTemplate = useCallback(
    (template: ComposerTemplateInput) => {
      const referencedContentIds = collectComposerInlineContentIds(
        template.body.html
      );
      setReferencedInlineContentIds?.(referencedContentIds);
      if (controller !== undefined) {
        const detachedContentIds = getDetachedInlineContentIds(
          controller,
          referencedContentIds
        );
        if (detachedContentIds.length > 0) {
          fallbackInlineImagesToAttachments?.(detachedContentIds);
        }
      }
      onApplyTemplate?.(template);
    },
    [
      controller,
      fallbackInlineImagesToAttachments,
      onApplyTemplate,
      setReferencedInlineContentIds,
    ]
  );

  const handleAttachmentFiles = useCallback(
    (files: FileList | null): void => {
      void addAttachments?.(files);
    },
    [addAttachments]
  );

  const handleAttachmentRemove = useCallback(
    (attachmentId: string): void => {
      controller?.removeAttachment(attachmentId);
    },
    [controller]
  );

  return {
    handleApplyTemplate,
    handleAttachmentFiles,
    handleAttachmentRemove,
    handleChange,
    handleComposerFiles,
  };
};

const MailComposer = ({
  aiActionGroupLabel = "AI composer actions",
  aiActions = NO_AI_ACTIONS,
  attachments,
  disabled = false,
  groupAiActions = false,
  history,
  onApplyTemplate,
  onChange,
  ...composerProps
}: MailComposerProps) => {
  const attachmentController = attachments?.controller;
  const {
    handleApplyTemplate,
    handleAttachmentFiles,
    handleAttachmentRemove,
    handleChange,
    handleComposerFiles,
  } = useMailComposerAttachmentHandlers(
    attachmentController,
    onApplyTemplate,
    onChange
  );
  const attachmentCommand = attachments?.command ?? "composer.attach";
  useAppCommand(
    attachmentCommand,
    () => attachmentController?.inputRef.current?.click(),
    { enabled: attachments !== undefined && !disabled }
  );

  const aiButtons = aiActions.map((action) => {
    const handleClick = action.onClick;

    return (
      <AiComposerButton
        command={action.command}
        disabled={action.disabled}
        grouped={groupAiActions}
        icon={action.icon}
        isWorking={action.isWorking}
        key={action.command}
        label={action.label}
        modelLabel={action.modelLabel}
        onClick={handleClick}
        popover={action.popover}
        workingLabel={action.workingLabel}
      />
    );
  });
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
        getInlineImagePreview={attachmentController?.getInlineImagePreview}
        onApplyTemplate={handleApplyTemplate}
        onChange={handleChange}
        onComposerFiles={
          attachmentController === undefined ? undefined : handleComposerFiles
        }
        onInlineImageInsertDiscard={attachmentController?.discardInlineImages}
        onInlineImageInsertFailure={
          attachmentController?.fallbackInlineImagesToAttachments
        }
        toolbarActions={
          <>
            {aiControls}
            {attachments === undefined ? null : (
              <OutgoingAttachmentButton
                command={attachments.command}
                disabled={disabled}
                focusRef={attachments.focusRef}
                inputRef={attachments.controller.inputRef}
                onFiles={handleAttachmentFiles}
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
          attachments={attachments.controller.attachments.filter(
            ({ contentId }) => contentId === undefined
          )}
          onRemove={handleAttachmentRemove}
        />
      )}
    </>
  );
};

export default MailComposer;
