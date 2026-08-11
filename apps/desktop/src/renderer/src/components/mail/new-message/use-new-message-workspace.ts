import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";

import { useNewMessageAttachments } from "@/components/mail/new-message-attachments";
import { useComposerFocus } from "@/components/mail/use-composer-focus";
import { getHotkeyDisplay, useAppCommand } from "@/hotkeys";
import {
  createNewMailDraft,
  getDraftResumeFocusTarget,
  getNewMailStashCommandAction,
  isNewMailDraftEmpty,
} from "@/mail/mail-draft";
import { getMailApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { MailDraft, MailDraftInput } from "@/shared/ipc/mail";
import type { ComposerTemplateInput } from "@/shared/ipc/templates";
import { useComposerTemplates } from "@/state/composer-templates";
import { applyComposerTemplate } from "@/templates/apply-composer-template";

import {
  runQueuedDraftOperation,
  toOptimisticStash,
  upsertStash,
  useDraftPersistence,
} from "./new-message-draft-persistence";
import { useNewMessageStore } from "./new-message-store";

export const useNewMessageWorkspace = ({
  accounts,
  isOpen,
  onOpenChange,
}: {
  accounts: readonly GoogleAccount[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) => {
  const accountId = useNewMessageStore((state) => state.accountId);
  const composer = useNewMessageStore((state) => state.composer);
  const draftId = useNewMessageStore((state) => state.draftId);
  const isSending = useNewMessageStore((state) => state.isSending);
  const recipients = useNewMessageStore((state) => state.recipients);
  const stashes = useNewMessageStore((state) => state.stashes);
  const subject = useNewMessageStore((state) => state.subject);
  const setAccountId = useNewMessageStore((state) => state.setAccountId);
  const setComposer = useNewMessageStore((state) => state.setComposer);
  const setDraftId = useNewMessageStore((state) => state.setDraftId);
  const setIsSending = useNewMessageStore((state) => state.setIsSending);
  const setRecipients = useNewMessageStore((state) => state.setRecipients);
  const setStashes = useNewMessageStore((state) => state.setStashes);
  const setSubject = useNewMessageStore((state) => state.setSubject);
  const updateStashes = useNewMessageStore((state) => state.updateStashes);
  const incrementRecipientResetVersion = useNewMessageStore(
    (state) => state.incrementRecipientResetVersion
  );
  const { addAttachments, attachments, inputRef, setAttachments } =
    useNewMessageAttachments();
  const { templates } = useComposerTemplates();
  const draftOperationQueueRef = useRef(Promise.resolve());
  const stashPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mailApi = useMemo(() => getMailApi(), []);
  const { persistDraft, popDraft } = useDraftPersistence(mailApi);
  const focus = useComposerFocus();
  const selectedAccountId = accounts.some(({ email }) => email === accountId)
    ? accountId
    : "";
  const currentDraft = useMemo<MailDraftInput>(
    () => ({
      ...(selectedAccountId.length === 0
        ? {}
        : { accountId: selectedAccountId }),
      attachments,
      bcc: recipients.bcc,
      body: { html: composer.html, text: composer.text },
      cc: recipients.cc,
      id: draftId,
      kind: "new",
      subject,
      to: recipients.to,
    }),
    [
      attachments,
      composer.html,
      composer.text,
      draftId,
      recipients.bcc,
      recipients.cc,
      recipients.to,
      selectedAccountId,
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

  useLayoutEffect(() => {
    focus.restorePending();
  }, [draftId, focus]);

  const availableStashes = stashes.filter(({ id }) => id !== draftId);
  const stashCommandAction = getNewMailStashCommandAction(
    currentDraft,
    availableStashes.length > 0
  );
  const canStash = stashCommandAction === "stash" && !isSending;
  const canSend =
    mailApi !== undefined &&
    selectedAccountId.length > 0 &&
    currentDraft.to.length > 0 &&
    currentDraft.subject.trim().length > 0 &&
    !composer.isEmpty &&
    !isSending;

  useEffect(() => {
    if (mailApi === undefined) {
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
  }, [accounts, mailApi, setStashes, updateStashes]);

  const applyDraft = (draft: MailDraftInput): void => {
    currentDraftRef.current = draft;
    setAccountId(draft.accountId ?? "");
    setAttachments(draft.attachments);
    setComposer({
      html: draft.body.html,
      isEmpty: draft.body.text.trim().length === 0,
      text: draft.body.text,
    });
    setDraftId(draft.id);
    setRecipients({ bcc: draft.bcc, cc: draft.cc, to: draft.to });
    setSubject(draft.subject);
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
        attachments,
        bcc: recipients.bcc,
        body: { html: composer.html, text: composer.text },
        cc: recipients.cc,
        subject,
        to: recipients.to,
      },
      applicableTemplate
    );
    setAccountId(applied.accountId);
    setComposer({
      html: applied.body.html,
      isEmpty: applied.body.text.trim().length === 0,
      text: applied.body.text,
    });
    incrementRecipientResetVersion();
    setRecipients({ bcc: applied.bcc, cc: applied.cc, to: applied.to });
    setSubject(applied.subject);
  };

  const stashCurrentDraft = (): void => {
    const draft = currentDraftRef.current;
    if (isSending || isNewMailDraftEmpty(draft)) {
      return;
    }
    const optimisticStash = toOptimisticStash(draft);
    const blankDraft = createNewMailDraft(draft.accountId);
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
    if (next.id === draftId || isSending) {
      return;
    }
    updateStashes((current) => current.filter(({ id }) => id !== next.id));
    focus.requestRestore(getDraftResumeFocusTarget(next));
    applyDraft(next);
    enqueueDraftOperation(async () => {
      const succeeded = await popDraft(next);
      if (!succeeded) {
        updateStashes((current) => upsertStash(current, next));
      }
    });
  };

  const send = async (): Promise<void> => {
    if (!(canSend && mailApi)) {
      return;
    }
    setIsSending(true);
    try {
      const reply = await mailApi.sendMessage({
        accountId: selectedAccountId,
        attachments: attachments.map(({ filename, mediaType, path }) => ({
          filename,
          mediaType,
          path,
        })),
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

  useAppCommand("composer.send", send, { enabled: isOpen && canSend });
  useAppCommand(
    "composer.stash",
    () => {
      if (stashCommandAction === "open-picker") {
        stashPickerTriggerRef.current?.click();
      } else if (stashCommandAction === "stash") {
        stashCurrentDraft();
      }
    },
    { enabled: isOpen && !isSending && stashCommandAction !== "none" }
  );

  return {
    addAttachments,
    applyTemplate,
    attachments,
    availableStashes,
    canSend,
    canStash,
    focus,
    inputRef,
    selectedAccountId,
    send,
    sendDisplay: getHotkeyDisplay("composer.send"),
    setAttachments,
    stashCurrentDraft,
    stashPickerTriggerRef,
    switchDraft,
    templates,
  };
};
