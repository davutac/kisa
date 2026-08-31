import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import type { EmailComposerValue } from "@/components/mail/email-composer";
import { useComposerFocus } from "@/components/mail/use-composer-focus";
import { useOutgoingAttachments } from "@/components/mail/use-outgoing-attachments";
import { getHotkeyDisplay, useAppCommand } from "@/hotkeys";
import {
  changeNewMailDraftAccount,
  createNewMailDraft,
  getDraftResumeFocusTarget,
  getNewMailStashCommandAction,
  isNewMailDraftEmpty,
  toMailDraftComposerValue,
  updateMailDraftBody,
} from "@/mail/mail-draft";
import { getMailApi } from "@/platform/desktop";
import {
  appendEmailSignatureBody,
  createEmailSignatureBody,
  EMPTY_EMAIL_SIGNATURE_BODY,
} from "@/shared/email-signature";
import type { EmailSignatureBody } from "@/shared/email-signature";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { MailDraft, MailDraftInput } from "@/shared/ipc/mail";
import type { ScheduledMailEditSession } from "@/shared/ipc/scheduled-mail";
import type { ComposerTemplateInput } from "@/shared/ipc/templates";
import { useAllAccountSettings } from "@/state/account-settings";
import { useComposerTemplates } from "@/state/composer-templates";
import { applyComposerTemplate } from "@/templates/apply-composer-template";

import {
  runQueuedDraftOperation,
  toOptimisticStash,
  upsertStash,
  useDraftPersistence,
} from "./new-message-draft-persistence";
import { useNewMessageStore, useNewMessageStoreApi } from "./new-message-store";
import { useNewMessageCleanHistory } from "./use-new-message-clean-history";
import { useScheduledComposer } from "./use-scheduled-composer";

export const useNewMessageWorkspace = ({
  accounts,
  isOpen,
  onOpenChange,
  onScheduledEditChange,
  scheduledEdit,
}: {
  accounts: readonly GoogleAccount[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onScheduledEditChange?: (session: ScheduledMailEditSession) => void;
  scheduledEdit?: ScheduledMailEditSession;
}) => {
  const store = useNewMessageStoreApi();
  const accountId = useNewMessageStore((state) => state.accountId);
  const composer = useNewMessageStore((state) => state.composer);
  const draftId = useNewMessageStore((state) => state.draftId);
  const isSending = useNewMessageStore((state) => state.isSending);
  const isScheduling = useNewMessageStore((state) => state.isScheduling);
  const recipients = useNewMessageStore((state) => state.recipients);
  const stashes = useNewMessageStore((state) => state.stashes);
  const signature = useNewMessageStore((state) => state.signature);
  const subject = useNewMessageStore((state) => state.subject);
  const setAccountId = useNewMessageStore((state) => state.setAccountId);
  const setComposer = useNewMessageStore((state) => state.setComposer);
  const setDraftId = useNewMessageStore((state) => state.setDraftId);
  const setIsSending = useNewMessageStore((state) => state.setIsSending);
  const setRecipients = useNewMessageStore((state) => state.setRecipients);
  const setStashes = useNewMessageStore((state) => state.setStashes);
  const setSignature = useNewMessageStore((state) => state.setSignature);
  const setSubject = useNewMessageStore((state) => state.setSubject);
  const updateStashes = useNewMessageStore((state) => state.updateStashes);
  const incrementRecipientResetVersion = useNewMessageStore(
    (state) => state.incrementRecipientResetVersion
  );
  const { templates } = useComposerTemplates();
  const accountSettings = useAllAccountSettings();
  const draftOperationQueueRef = useRef(Promise.resolve());
  const stashPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [hasPendingReschedule, setHasPendingReschedule] = useState(false);
  const mailApi = useMemo(() => getMailApi(), []);
  const outgoingAttachments = useOutgoingAttachments(
    mailApi,
    scheduledEdit?.draft.attachments,
    scheduledEdit?.draft.body.html
  );
  const {
    activeAttachments,
    isAuthorizing,
    prepareAttachments,
    replaceAttachments,
  } = outgoingAttachments;
  const { persistDraft, popDraft } = useDraftPersistence(mailApi);
  const focus = useComposerFocus();
  const cleanup = useNewMessageCleanHistory({ focus, isOpen });
  const selectedAccountId = accounts.some(({ email }) => email === accountId)
    ? accountId
    : "";
  const currentDraft = useMemo<MailDraftInput>(
    () => ({
      accountId: selectedAccountId.length === 0 ? undefined : selectedAccountId,
      attachments: activeAttachments,
      bcc: recipients.bcc,
      body: { html: composer.html, text: composer.text },
      cc: recipients.cc,
      id: draftId,
      kind: "new",
      signature,
      subject,
      to: recipients.to,
    }),
    [
      activeAttachments,
      composer.html,
      composer.text,
      draftId,
      recipients.bcc,
      recipients.cc,
      recipients.to,
      selectedAccountId,
      signature,
      subject,
    ]
  );
  const currentDraftRef = useRef(currentDraft);

  const enqueueDraftOperation = useCallback(
    (operation: () => Promise<void>): void => {
      draftOperationQueueRef.current = runQueuedDraftOperation(
        draftOperationQueueRef.current,
        operation
      );
    },
    []
  );

  useEffect(() => {
    currentDraftRef.current = currentDraft;
  }, [currentDraft]);

  const applyDraft = (draft: MailDraftInput): void => {
    cleanup.reset();
    currentDraftRef.current = draft;
    setAccountId(draft.accountId ?? "");
    replaceAttachments(draft.attachments, draft.body.html);
    setComposer(toMailDraftComposerValue(draft));
    setDraftId(draft.id);
    setRecipients({ bcc: draft.bcc, cc: draft.cc, to: draft.to });
    setSubject(draft.subject);
    setSignature(draft.signature);
  };

  useLayoutEffect(() => {
    focus.restorePending();
  }, [draftId, focus]);

  const availableStashes = stashes.filter(({ id }) => id !== draftId);
  const stashCommandAction = getNewMailStashCommandAction(
    currentDraft,
    availableStashes.length > 0
  );
  const isBusy = [
    cleanup.isCleaning,
    isAuthorizing,
    isScheduling,
    isSending,
  ].some(Boolean);
  const isScheduledEdit = scheduledEdit !== undefined;
  const canStash =
    !isScheduledEdit && stashCommandAction === "stash" && !isBusy;
  const canSend =
    mailApi !== undefined &&
    selectedAccountId.length > 0 &&
    currentDraft.to.length > 0 &&
    currentDraft.subject.trim().length > 0 &&
    !composer.isEmpty &&
    !isBusy;
  const scheduled = useScheduledComposer({
    canSend,
    currentDraft,
    hasPendingReschedule,
    isBusy,
    onOpenChange,
    onSessionChange: (session) => {
      applyDraft(session.draft);
      onScheduledEditChange?.(session);
    },
    scheduledEdit,
    selectedAccountId,
  });

  useEffect(() => {
    if (mailApi === undefined || scheduledEdit !== undefined) {
      return;
    }
    let active = true;
    const load = async (): Promise<void> => {
      try {
        const reply = await mailApi.listStashedDrafts({
          accountIds: accounts.map(({ email }) => email),
        });
        if (!(active && reply.ok)) {
          if (active && !reply.ok) {
            toast.error(reply.error);
          }
          return;
        }
        setStashes(reply.data);
      } catch {
        if (active) {
          toast.error("Could not load stashed drafts");
        }
      }
    };
    void load();
    const unsubscribe = mailApi.onDraftChanged((change) => {
      if (change.kind === "remove") {
        updateStashes((current) =>
          current.filter(({ id }) => id !== change.draftId)
        );
        return;
      }
      if (
        change.draft.kind !== "new" ||
        (change.draft.accountId !== undefined &&
          !accounts.some(({ email }) => email === change.draft.accountId))
      ) {
        return;
      }
      updateStashes((current) => upsertStash(current, change.draft));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [accounts, mailApi, scheduledEdit, setStashes, updateStashes]);

  const getEmailSignature = (nextAccountId: string): EmailSignatureBody =>
    accountSettings.find(({ accountId: id }) => id === nextAccountId)
      ?.emailSignature ?? EMPTY_EMAIL_SIGNATURE_BODY;

  const selectAccount = (nextAccountId: string): void => {
    const nextDraft = changeNewMailDraftAccount(
      currentDraftRef.current,
      nextAccountId,
      getEmailSignature(nextAccountId),
      getEmailSignature(currentDraftRef.current.accountId ?? "")
    );
    currentDraftRef.current = nextDraft;
    setAccountId(nextAccountId);
    setSignature(nextDraft.signature);
    setComposer(toMailDraftComposerValue(nextDraft));
    focus.replaceContent("message", nextDraft.body.html);
  };

  const applyTemplate = (template: ComposerTemplateInput): void => {
    const applicableTemplate =
      template.accountId === null ||
      accounts.some(({ email }) => email === template.accountId)
        ? template
        : { ...template, accountId: null };
    const applied = applyComposerTemplate(
      {
        accountId: selectedAccountId,
        attachments: currentDraft.attachments,
        bcc: recipients.bcc,
        body: { html: composer.html, text: composer.text },
        cc: recipients.cc,
        subject,
        to: recipients.to,
      },
      applicableTemplate,
      scheduledEdit?.item.accountId
    );
    const signatureBody = createEmailSignatureBody(
      getEmailSignature(applied.accountId)
    );
    const appliedSignature =
      signatureBody === undefined || applied.accountId.length === 0
        ? undefined
        : { accountId: applied.accountId, body: signatureBody };
    const appliedBody =
      appliedSignature === undefined
        ? applied.body
        : appendEmailSignatureBody(applied.body, appliedSignature.body);
    cleanup.reset();
    setAccountId(applied.accountId);
    setComposer({
      html: appliedBody.html,
      isEmpty: applied.body.text.trim().length === 0,
      text: appliedBody.text,
    });
    setSignature(appliedSignature);
    focus.replaceContent("message", appliedBody.html);
    incrementRecipientResetVersion();
    setRecipients({ bcc: applied.bcc, cc: applied.cc, to: applied.to });
    setSubject(applied.subject);
  };

  const stashCurrentDraft = (): void => {
    const draft = currentDraftRef.current;
    if (isBusy || isNewMailDraftEmpty(draft)) {
      return;
    }
    const optimisticStash = toOptimisticStash(draft);
    const blankDraft = createNewMailDraft(
      draft.accountId,
      draft.accountId === undefined
        ? EMPTY_EMAIL_SIGNATURE_BODY
        : getEmailSignature(draft.accountId)
    );
    const focusTarget = focus.getCurrentTarget();
    updateStashes((current) => upsertStash(current, optimisticStash));
    focus.requestRestore(focusTarget);
    applyDraft(blankDraft);
    enqueueDraftOperation(async () => {
      const succeeded = await persistDraft(draft);
      if (succeeded) {
        toast.success("Draft stashed");
        return;
      }
      updateStashes((current) =>
        current.filter(({ id }) => id !== optimisticStash.id)
      );
      if (
        currentDraftRef.current.id === blankDraft.id &&
        isNewMailDraftEmpty(currentDraftRef.current)
      ) {
        focus.requestRestore(focusTarget);
        applyDraft(draft);
      }
    });
  };

  const switchDraft = (next: MailDraft): void => {
    if (next.id === draftId || isBusy) {
      return;
    }
    updateStashes((current) => current.filter(({ id }) => id !== next.id));
    focus.requestRestore(getDraftResumeFocusTarget(next));
    applyDraft(next);
    enqueueDraftOperation(async () => {
      const succeeded = await popDraft(next, true);
      if (!succeeded) {
        updateStashes((current) => upsertStash(current, next));
      }
    });
  };

  const send = async (): Promise<void> => {
    if (!(canSend && mailApi)) {
      return;
    }
    if (scheduled.isEdit) {
      await scheduled.sendNow();
      return;
    }
    setIsSending(true);
    try {
      const preparedAttachments = await prepareAttachments(
        currentDraft.attachments
      );
      if (preparedAttachments === undefined) {
        return;
      }
      const reply = await mailApi.sendMessage({
        accountId: selectedAccountId,
        attachments: preparedAttachments,
        bcc: recipients.bcc,
        body: currentDraft.body,
        cc: recipients.cc,
        subject,
        to: recipients.to,
      });
      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }
      enqueueDraftOperation(async () => {
        await popDraft(currentDraft);
      });
      toast.success("Message sent");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send message"
      );
    } finally {
      setIsSending(false);
    }
  };

  const updateComposer = (nextComposer: EmailComposerValue): void => {
    const draft = updateMailDraftBody(
      {
        ...currentDraftRef.current,
        signature: store.getState().signature,
      },
      { html: nextComposer.html, text: nextComposer.text }
    );
    setSignature(draft.signature);
    cleanup.updateComposer(toMailDraftComposerValue(draft));
  };

  useAppCommand("composer.send", send, { enabled: isOpen && canSend });
  useAppCommand(
    "composer.clean",
    () => {
      void cleanup.cleanDraft();
    },
    { enabled: isOpen && cleanup.canClean }
  );
  useAppCommand(
    "composer.stash",
    () => {
      if (scheduled.isEdit) {
        void scheduled.save();
      } else if (stashCommandAction === "open-picker") {
        stashPickerTriggerRef.current?.click();
      } else if (stashCommandAction === "stash") {
        stashCurrentDraft();
      }
    },
    {
      enabled: scheduled.isEdit
        ? isOpen && scheduled.isDirty && canSend
        : isOpen && !isBusy && stashCommandAction !== "none",
    }
  );

  return {
    applyTemplate,
    availableStashes,
    canClean: cleanup.canClean,
    canSend,
    canStash,
    cleanDraft: cleanup.cleanDraft,
    cleanupModelLabel: cleanup.modelLabel,
    dismissCleanVersion: cleanup.dismissVersion,
    focus,
    isCleaning: cleanup.isCleaning,
    outgoingAttachments,
    requestClose: scheduled.requestClose,
    scheduled: {
      canSchedule: scheduled.canSchedule,
      isDirty: scheduled.isDirty,
      isEdit: scheduled.isEdit,
      onDiscard: scheduled.discard,
      onPendingScheduleChange: setHasPendingReschedule,
      onSave: scheduled.save,
      onSchedule: scheduled.schedule,
      scheduledAt: scheduledEdit?.item.scheduledAt,
    },
    selectAccount,
    selectCleanVersion: cleanup.selectVersion,
    selectedAccountId,
    send,
    sendDisplay: getHotkeyDisplay("composer.send"),
    stashCurrentDraft,
    stashPickerTriggerRef,
    switchDraft,
    templates,
    updateComposer,
    updateSubject: cleanup.updateSubject,
  };
};
