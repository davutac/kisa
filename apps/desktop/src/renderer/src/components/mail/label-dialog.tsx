import { LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";

import LabelColorField, {
  isGmailLabelColorValue,
} from "@/components/mail/label-color-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHotkeyLayer } from "@/hotkeys";
import { gmailLabelTextColor } from "@/mail/label";
import type { MailApi } from "@/platform/desktop";
import type {
  GmailLabelInputColor,
  GmailLabelSummary,
} from "@/shared/ipc/mail";

interface LabelDialogProps {
  readonly accountId: string;
  readonly existingLabels: readonly GmailLabelSummary[];
  readonly isOpen: boolean;
  readonly label?: GmailLabelSummary;
  readonly mailApi: MailApi;
  readonly onSaved: (label: GmailLabelSummary) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
}

const toGmailLabelInputColor = (
  background: string | undefined,
  text: string | undefined
): GmailLabelInputColor | undefined => {
  if (
    background === undefined ||
    text === undefined ||
    !isGmailLabelColorValue(background) ||
    !isGmailLabelColorValue(text)
  ) {
    return;
  }

  return { background, text };
};

const isLabelColorChanged = (
  label: GmailLabelSummary | undefined,
  color: GmailLabelInputColor | undefined
): boolean =>
  color !== undefined &&
  (color.background !== label?.color?.background ||
    color.text !== label?.color?.text);

const LABEL_DIALOG_COPY = {
  create: {
    description: "Add a label for",
    error: "Could not create the label",
    saving: "Creating…",
    submit: "Create label",
    success: "Created",
    title: "Create label",
  },
  edit: {
    description: "Update the label for",
    error: "Could not update the label",
    saving: "Saving…",
    submit: "Save changes",
    success: "Updated",
    title: "Edit label",
  },
} as const;

const LabelDialog = ({
  accountId,
  existingLabels,
  isOpen,
  label,
  mailApi,
  onSaved,
  onOpenChange,
}: LabelDialogProps) => {
  const inputId = useId();
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState(label?.name ?? "");
  const [selectedBackground, setSelectedBackground] = useState<
    string | undefined
  >(label?.color?.background);
  const [selectedText, setSelectedText] = useState<string | undefined>(
    label?.color?.text
  );
  const trimmedName = name.trim();
  const alreadyExists = existingLabels.some(
    (candidate) => candidate.id !== label?.id && candidate.name === trimmedName
  );
  const selectedColor = toGmailLabelInputColor(
    selectedBackground,
    selectedText
  );
  const colorChanged = isLabelColorChanged(label, selectedColor);
  const hasChanges =
    label === undefined || trimmedName !== label.name || colorChanged;
  const canSubmit =
    trimmedName.length > 0 && !alreadyExists && !isSaving && hasChanges;
  const copy =
    label === undefined ? LABEL_DIALOG_COPY.create : LABEL_DIALOG_COPY.edit;
  const submitLabel = isSaving ? copy.saving : copy.submit;

  useHotkeyLayer("blocking", isOpen);

  const reset = (): void => {
    setName(label?.name ?? "");
    setSelectedBackground(label?.color?.background);
    setSelectedText(label?.color?.text);
  };

  const setOpen = (open: boolean): void => {
    if (isSaving) {
      return;
    }

    if (!open) {
      reset();
    }
    onOpenChange(open);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);

    try {
      const reply =
        label === undefined
          ? await mailApi.createLabel({
              accountId,
              color: selectedColor,
              name: trimmedName,
            })
          : await mailApi.updateLabel({
              accountId,
              color: colorChanged ? selectedColor : undefined,
              labelId: label.id,
              name: trimmedName,
            });

      if (!reply.ok) {
        toast.error(reply.error);
        return;
      }

      onSaved(reply.data);
      toast.success(`${copy.success} “${reply.data.name}”`);
      reset();
      onOpenChange(false);
    } catch {
      toast.error(copy.error, {
        description: "Please try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={isOpen}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isSaving}>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description} {accountId}. Changes are also saved to Gmail.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor={inputId}>Name</Label>
            <Input
              aria-invalid={alreadyExists || undefined}
              autoComplete="off"
              autoFocus
              disabled={isSaving}
              id={inputId}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
              placeholder="Receipts"
              value={name}
            />
            {alreadyExists ? (
              <p className="text-destructive text-xs" role="alert">
                A label with this name already exists.
              </p>
            ) : null}
          </div>

          <LabelColorField
            disabled={isSaving}
            label={trimmedName || "New label"}
            onClear={
              label?.color === undefined
                ? () => {
                    setSelectedBackground(undefined);
                    setSelectedText(undefined);
                  }
                : undefined
            }
            onSelectBackground={(background) => {
              setSelectedBackground(background);
              setSelectedText((current) =>
                current !== undefined && isGmailLabelColorValue(current)
                  ? current
                  : gmailLabelTextColor(background)
              );
            }}
            onSelectText={(text) => {
              setSelectedText(text);
              setSelectedBackground((current) =>
                current !== undefined && isGmailLabelColorValue(current)
                  ? current
                  : gmailLabelTextColor(text)
              );
            }}
            selectedBackground={selectedBackground}
            selectedText={selectedText}
          />

          <DialogFooter className="-mx-4 -mb-4 gap-px overflow-hidden rounded-b-lg">
            <DialogClose
              disabled={isSaving}
              render={<Button size="footer" type="button" variant="outline" />}
            >
              Cancel
            </DialogClose>
            <Button disabled={!canSubmit} size="footer" type="submit">
              {isSaving ? <LoaderCircleIcon className="animate-spin" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default LabelDialog;
