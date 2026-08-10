import { ArchiveIcon, LoaderCircleIcon, SendIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import EmailRecipientFields from "@/components/mail/email-recipient-fields";
import type { EmailRecipients } from "@/components/mail/email-recipient-fields";
import NewMessageAccountPicker from "@/components/mail/new-message-account-picker";
import {
  NewMessageAttachmentButton,
  NewMessageAttachmentList,
  useNewMessageAttachments,
} from "@/components/mail/new-message-attachments";
import NewMessageDialogShell from "@/components/mail/new-message-dialog-shell";
import NewMessageStashPicker from "@/components/mail/new-message-stash-picker";
import { useComposerFocus } from "@/components/mail/use-composer-focus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import { getInitialComposerAccountId } from "@/mail/composer-account";
import {
  createNewMailDraft,
  getNewMailStashCommandAction,
  getDraftResumeFocusTarget,
  isNewMailDraftEmpty,
} from "@/mail/mail-draft";
import { getMailApi } from "@/platform/desktop";
import type { MailApi } from "@/platform/desktop";
import type { GoogleAccount } from "@/shared/ipc/auth";
import type { MailDraft, MailDraftInput } from "@/shared/ipc/mail";

interface NewMessageDialogProps {
  accounts: readonly GoogleAccount[];
  initialAccountId: string | null;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const EMPTY_COMPOSER_VALUE: EmailComposerValue = {
  html: "",
  isEmpty: true,
  text: "",
};

const EMPTY_RECIPIENTS: EmailRecipients = { bcc: [], cc: [], to: [] };

const toOptimisticStash = (draft: MailDraftInput): MailDraft => {
  const now = Date.now();
  return { ...draft, createdAt: now, updatedAt: now };
};

const upsertStash = (
  stashes: readonly MailDraft[],
  draft: MailDraft
): readonly MailDraft[] =>
  [draft, ...stashes.filter(({ id }) => id !== draft.id)].toSorted(
    (left, right) => right.updatedAt - left.updatedAt
  );

const runQueuedDraftOperation = async (
  previous: Promise<void>,
  operation: () => Promise<void>
): Promise<void> => {
  try {
    await previous;
  } catch {
    // A failed operation must not prevent later stashes from being persisted.
  }
  await operation();
};

const useDraftPersistence = (mailApi: MailApi | undefined) => {
  const persistDraft = useCallback(
    async (draft: MailDraftInput): Promise<boolean> => {
      if (mailApi === undefined) {
        return false;
      }

      try {
        const reply = await mailApi.saveDraft(draft);
        if (!reply.ok) {
          toast.error(reply.error);
          return false;
        }

        return true;
      } catch {
        toast.error("Could not save draft");
        return false;
      }
    },
    [mailApi]
  );

  const popDraft = useCallback(
    async (draft: MailDraftInput): Promise<boolean> => {
      if (mailApi === undefined) {
        return false;
      }

      try {
        const reply = await mailApi.discardDraft({
          ...(draft.accountId === undefined
            ? {}
            : { accountId: draft.accountId }),
          draftId: draft.id,
        });
        if (!reply.ok) {
          toast.error(reply.error);
          return false;
        }

        return true;
      } catch {
        toast.error("Could not update stashes");
        return false;
      }
    },
    [mailApi]
  );

  return { persistDraft, popDraft };
};

const NewMessageDialog = ({
  accounts,
  initialAccountId,
  isOpen,
  onOpenChange,
}: NewMessageDialogProps) => {
  const [accountId, setAccountId] = useState(() =>
    getInitialComposerAccountId(accounts, initialAccountId)
  );
  const { addAttachments, attachments, inputRef, setAttachments } =
    useNewMessageAttachments();
  const [composer, setComposer] = useState(EMPTY_COMPOSER_VALUE);
  const [draftId, setDraftId] = useState<string>(() => crypto.randomUUID());
  const [isSending, setIsSending] = useState(false);
  const [recipients, setRecipients] = useState(EMPTY_RECIPIENTS);
  const [stashes, setStashes] = useState<readonly MailDraft[]>([]);
  const [subject, setSubject] = useState("");
  const draftOperationQueueRef = useRef(Promise.resolve());
  const stashPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mailApi = useMemo(() => getMailApi(), []);
  const { persistDraft, popDraft } = useDraftPersistence(mailApi);
  const {
    getCurrentTarget,
    getElement,
    getReturnElement,
    handleRefFor,
    onFocusCapture,
    refFor,
    requestRestore,
    restorePending,
  } = useComposerFocus();
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
    restorePending();
  }, [draftId, restorePending]);
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
  const sendDisplay = getHotkeyDisplay("composer.send");

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
        setStashes((current) =>
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

      setStashes((current) => upsertStash(current, change.draft));
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [accounts, mailApi]);

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

  const stashCurrentDraft = (): void => {
    const draft = currentDraftRef.current;
    if (isSending) {
      return;
    }

    if (isNewMailDraftEmpty(draft)) {
      return;
    }

    const optimisticStash = toOptimisticStash(draft);
    const blankDraft = createNewMailDraft(draft.accountId);
    const focusTarget = getCurrentTarget();
    setStashes((current) => upsertStash(current, optimisticStash));
    requestRestore(focusTarget);
    applyDraft(blankDraft);

    enqueueDraftOperation(async () => {
      const succeeded = await persistDraft(draft);
      if (succeeded) {
        toast.success("Draft stashed");
        return;
      }

      setStashes((current) =>
        current.filter(({ id }) => id !== optimisticStash.id)
      );
      if (
        currentDraftRef.current.id === blankDraft.id &&
        isNewMailDraftEmpty(currentDraftRef.current)
      ) {
        requestRestore(focusTarget);
        applyDraft(draft);
      }
    });
  };

  const switchDraft = (next: MailDraft): void => {
    if (next.id === draftId || isSending) {
      return;
    }

    setStashes((current) => current.filter(({ id }) => id !== next.id));
    requestRestore(getDraftResumeFocusTarget(next));
    applyDraft(next);

    enqueueDraftOperation(async () => {
      const succeeded = await popDraft(next);
      if (!succeeded) {
        setStashes((current) => upsertStash(current, next));
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

  useAppCommand(
    "composer.send",
    () => {
      void send();
    },
    { enabled: isOpen && canSend }
  );
  useAppCommand(
    "composer.stash",
    () => {
      if (stashCommandAction === "open-picker") {
        stashPickerTriggerRef.current?.click();
      } else if (stashCommandAction === "stash") {
        stashCurrentDraft();
      }
    },
    {
      enabled: isOpen && !isSending && stashCommandAction !== "none",
    }
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isSending) {
          onOpenChange(false);
        }
      }}
      open={isOpen}
    >
      <NewMessageDialogShell
        initialFocus={() => getElement("to")}
        onFiles={addAttachments}
      >
        <DialogHeader className="shrink-0 px-4 py-3 pr-12">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="shrink-0">New email</DialogTitle>
            <div className="flex h-7 w-24 shrink-0 justify-end">
              {availableStashes.length > 0 ? (
                <NewMessageStashPicker
                  accountsCount={accounts.length}
                  disabled={isSending}
                  drafts={availableStashes}
                  getReturnFocus={getReturnElement}
                  onSelect={switchDraft}
                  triggerRef={stashPickerTriggerRef}
                />
              ) : null}
            </div>
          </div>
          <DialogDescription className="sr-only">
            Write, stash, or send a new email message
          </DialogDescription>
        </DialogHeader>
        <form
          className="bg-background flex min-h-0 flex-1 flex-col gap-px overflow-hidden"
          onFocusCapture={onFocusCapture}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <NewMessageAccountPicker
            accounts={accounts}
            focusRefForAccount={(email) => refFor(`account:${email}`)}
            onSelect={setAccountId}
            selectedAccountId={selectedAccountId}
          />
          <EmailRecipientFields
            accountId={selectedAccountId}
            className="shrink-0"
            inputRefs={{
              bcc: refFor("bcc"),
              cc: refFor("cc"),
              to: refFor("to"),
            }}
            onChange={setRecipients}
            resetKey={draftId}
            value={recipients}
          />
          <InputGroup className="bg-card dark:bg-card h-9 shrink-0 rounded-none border-0 px-4 shadow-none has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupAddon className="w-10 justify-start p-0">
              <label htmlFor="new-message-subject">Subject</label>
            </InputGroupAddon>
            <InputGroupInput
              className="h-8 px-0 text-sm md:text-sm"
              id="new-message-subject"
              onChange={(event) => setSubject(event.currentTarget.value)}
              ref={refFor("subject")}
              value={subject}
            />
          </InputGroup>
          <EmailComposer
            ariaLabel="Message"
            className="min-h-32 flex-1 border-0"
            consumeModEnter
            contentKey={draftId}
            defaultValue={composer.html}
            focusHandleRef={handleRefFor("message")}
            onChange={setComposer}
            placeholder="Write a message"
            toolbarActions={
              <NewMessageAttachmentButton
                focusRef={refFor("attachment")}
                inputRef={inputRef}
                onFiles={addAttachments}
              />
            }
          />
          <NewMessageAttachmentList
            attachments={attachments}
            onRemove={(attachmentId) =>
              setAttachments((current) =>
                current.filter(({ id }) => id !== attachmentId)
              )
            }
          />
          <div className="bg-background flex shrink-0 items-stretch gap-0">
            <Button
              aria-label="Stash draft"
              aria-keyshortcuts={getHotkeyAriaLabel("composer.stash")}
              className="border-background size-12 shrink-0 rounded-none border-0 border-r p-0"
              disabled={!canStash}
              onClick={() => {
                stashCurrentDraft();
              }}
              onMouseDown={(event) => event.preventDefault()}
              title="Stash draft"
              type="button"
              variant="secondary"
            >
              <ArchiveIcon />
            </Button>
            <Button
              aria-keyshortcuts={getHotkeyAriaLabel("composer.send")}
              className="relative h-auto min-w-0 flex-1 rounded-none border-0 px-4 py-2 text-lg"
              disabled={!canSend}
              title={`${sendDisplay.label} (${sendDisplay.bindings[0]?.join("+")})`}
              type="submit"
              variant="secondary"
            >
              {isSending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <SendIcon />
              )}
              {isSending ? "Sending…" : "Send"}
              <HotkeyHint
                className="absolute right-4"
                command="composer.send"
              />
            </Button>
          </div>
        </form>
      </NewMessageDialogShell>
    </Dialog>
  );
};

export default NewMessageDialog;
