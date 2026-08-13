import { useState } from "react";

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
import { Textarea } from "@/components/ui/textarea";
import { MAX_AI_INSTRUCTIONS_LENGTH } from "@/shared/ipc/ai";

interface AiInstructionsDialogProps {
  readonly description: string;
  readonly onSave: (instructions: string) => void;
  readonly placeholder: string;
  readonly title: string;
  readonly value: string;
}

const AiInstructionsDialog = ({
  description,
  onSave,
  placeholder,
  title,
  value,
}: AiInstructionsDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const trimmedDraft = draft.trim();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setDraft(value);
        }
        setIsOpen(open);
      }}
      open={isOpen}
    >
      <DialogTrigger render={<Button type="button" variant="secondary" />}>
        Edit
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea
          aria-label={title}
          className="min-h-72 resize-y font-mono text-xs leading-relaxed"
          maxLength={MAX_AI_INSTRUCTIONS_LENGTH}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          placeholder={placeholder}
          value={draft}
        />
        <DialogFooter className="-mx-4 -mb-4 gap-px overflow-hidden rounded-b-lg">
          <DialogClose
            render={<Button type="button" variant="outline" size="footer" />}
          >
            Cancel
          </DialogClose>
          <Button
            disabled={trimmedDraft === value}
            onClick={() => {
              onSave(trimmedDraft);
              setIsOpen(false);
            }}
            size="footer"
            type="button"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default AiInstructionsDialog;
