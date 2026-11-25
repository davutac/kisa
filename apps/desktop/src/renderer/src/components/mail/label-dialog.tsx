import { LoaderCircleIcon } from "lucide-react";
import { useId, useState } from "react";
import type { SubmitEvent } from "react";

import LabelColorField from "@/components/mail/label-color-field";
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
import { toast } from "@/components/ui/toast";
import { useHotkeyLayer } from "@/hotkeys";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import type { MailApi } from "@/platform/desktop";
import type { MailLabelSummary } from "@/shared/ipc/mail";
import { seededLabelColor } from "@/shared/label-color";

interface LabelDialogProps {
  readonly accountId: string;
  readonly existingLabels: readonly MailLabelSummary[];
  readonly isOpen: boolean;
  readonly label?: MailLabelSummary;
  readonly mailApi: MailApi;
  readonly onSaved: (label: MailLabelSummary) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
}

const resolveLabelColor = (
  label: MailLabelSummary | undefined,
  chosen: string | undefined,
  name: string
) => {
  const saved = label?.color?.background;
  return {
    color: chosen ?? saved ?? seededLabelColor(name),
    colorChanged: chosen !== undefined && chosen !== saved,
  };
};

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
  // Until a colour is chosen, a new label shows the one sync would give it.
  const [chosenColor, setChosenColor] = useState<string>();
  const trimmedName = name.trim();
  const alreadyExists = existingLabels.some(
    (candidate) => candidate.id !== label?.id && candidate.name === trimmedName
  );
  const { color, colorChanged } = resolveLabelColor(
    label,
    chosenColor,
    trimmedName
  );
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
    setChosenColor(undefined);
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

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSaving(true);

    await runWithCleanup(
      async () => {
        try {
          const reply =
            label === undefined
              ? await mailApi.createLabel({
                  accountId,
                  color,
                  name: trimmedName,
                })
              : await mailApi.updateLabel({
                  accountId,
                  color: colorChanged ? chosenColor : undefined,
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
        }
      },
      () => {
        setIsSaving(false);
      }
    );
  };

  return (
    <Dialog onOpenChange={setOpen} open={isOpen}>
      <DialogContent className="sm:max-w-md" showCloseButton={!isSaving}>
        <form className="contents" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>
              {copy.description} {accountId}. The label also changes on the mail
              server.
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
            onValueChange={setChosenColor}
            value={color}
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
