import { useState } from "react";

import EmailComposer from "@/components/mail/email-composer";
import type { EmailComposerValue } from "@/components/mail/email-composer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  MAX_EMAIL_SIGNATURE_HTML_LENGTH,
  MAX_EMAIL_SIGNATURE_TEXT_LENGTH,
  normalizeEmailSignature,
} from "@/shared/email-signature";
import type { EmailSignatureBody } from "@/shared/email-signature";

interface EmailSignatureDialogProps {
  readonly onSave: (signature: EmailSignatureBody) => Promise<boolean>;
  readonly triggerLabel: string;
  readonly value: EmailSignatureBody;
}

const toComposerValue = (
  signature: EmailSignatureBody
): EmailComposerValue => ({
  ...signature,
  isEmpty: signature.text.trim().length === 0,
});

const EmailSignatureDialog = ({
  onSave,
  triggerLabel,
  value,
}: EmailSignatureDialogProps) => {
  const [draft, setDraft] = useState(() => toComposerValue(value));
  const [editorVersion, setEditorVersion] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const normalizedDraft = normalizeEmailSignature(draft);
  const isUnchanged =
    normalizedDraft.html === value.html && normalizedDraft.text === value.text;
  const isTextTooLong = draft.text.length > MAX_EMAIL_SIGNATURE_TEXT_LENGTH;
  const isHtmlTooLong = draft.html.length > MAX_EMAIL_SIGNATURE_HTML_LENGTH;
  const isTooLong = isTextTooLong || isHtmlTooLong;

  const save = async (): Promise<void> => {
    setIsSaving(true);
    try {
      if (await onSave(normalizedDraft)) {
        setIsOpen(false);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (isSaving) {
          return;
        }
        if (open) {
          setDraft(toComposerValue(value));
          setEditorVersion((current) => current + 1);
        }
        setIsOpen(open);
      }}
      open={isOpen}
    >
      <DialogTrigger
        render={
          <Button aria-label={triggerLabel} type="button" variant="secondary" />
        }
      >
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" showCloseButton={!isSaving}>
        <DialogHeader>
          <DialogTitle>Email signature</DialogTitle>
          <DialogDescription>
            Kisa adds this sign-off to new messages, replies, and forwards from
            this account. You can edit or remove it before sending. Leave it
            blank to disable it.
          </DialogDescription>
        </DialogHeader>
        <EmailComposer
          aria-label="Email signature"
          className="border-border h-72 rounded-lg border"
          contentKey={String(editorVersion)}
          defaultValue={draft.html}
          disabled={isSaving}
          onChange={setDraft}
          placeholder={"Best,\nYour name"}
        />
        <div
          aria-live="polite"
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="text-destructive">
            {isHtmlTooLong ? "Reduce the formatting to save." : null}
          </span>
          <span
            className={
              isTextTooLong
                ? "text-destructive tabular-nums"
                : "text-muted-foreground tabular-nums"
            }
          >
            {draft.text.length.toLocaleString()}/
            {MAX_EMAIL_SIGNATURE_TEXT_LENGTH.toLocaleString()}
          </span>
        </div>
        <DialogFooter className="-mx-4 -mb-4 gap-px overflow-hidden rounded-b-lg">
          <DialogClose
            disabled={isSaving}
            render={<Button size="footer" type="button" variant="outline" />}
          >
            Cancel
          </DialogClose>
          <Button
            disabled={isSaving || isTooLong || isUnchanged}
            onClick={() => {
              void save();
            }}
            size="footer"
            type="button"
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EmailSignatureDialog;
