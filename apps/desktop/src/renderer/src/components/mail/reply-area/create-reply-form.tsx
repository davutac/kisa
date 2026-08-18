import { useState } from "react";
import type { FormEvent, RefObject } from "react";

import { Button } from "@/components/ui/button";
import { PopoverDescription, PopoverTitle } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { MAX_AI_OPERATION_INSTRUCTIONS_LENGTH } from "@/shared/ipc/ai";

interface CreateReplyFormProps {
  readonly onClose: () => void;
  readonly onCreate: (instructions?: string) => Promise<void>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
}

const CreateReplyForm = ({
  onClose,
  onCreate,
  textareaRef,
}: CreateReplyFormProps) => {
  const [instructions, setInstructions] = useState("");

  const handleSubmit = async (
    event: FormEvent<HTMLFormElement>
  ): Promise<void> => {
    event.preventDefault();
    const requestInstructions = instructions.trim() || undefined;
    setInstructions("");
    onClose();
    await onCreate(requestInstructions);
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-1">
        <PopoverTitle>Create reply</PopoverTitle>
        <PopoverDescription>
          Tell Kisa what the reply should say, or leave this blank to use the
          conversation context.
        </PopoverDescription>
      </div>
      <Textarea
        aria-label="Reply instructions"
        className="max-h-[40dvh] min-h-24 resize-y overflow-y-auto"
        maxLength={MAX_AI_OPERATION_INSTRUCTIONS_LENGTH}
        onChange={(event) => setInstructions(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="For example: Say Tuesday works and ask what time suits them."
        ref={textareaRef}
        value={instructions}
      />
      <Button className="w-full" size="sm" type="submit">
        Create
      </Button>
    </form>
  );
};

export default CreateReplyForm;
