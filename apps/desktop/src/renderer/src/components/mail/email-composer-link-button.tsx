import type { Editor } from "@tiptap/react";
import { LinkIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EmailComposerLinkButtonProps {
  disabled: boolean;
  editor: Editor;
  isActive: boolean;
}

const normalizeLinkHref = (value: string): string => {
  const href = value.trim();
  return /^[a-z][a-z\d+.-]*:/iu.test(href) ? href : `https://${href}`;
};

const EmailComposerLinkButton = ({
  disabled,
  editor,
  isActive,
}: EmailComposerLinkButtonProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [href, setHref] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [validationError, setValidationError] = useState("");

  const handleOpenChange = (open: boolean): void => {
    setIsOpen(open);
    setValidationError("");
    if (open) {
      setHref(String(editor.getAttributes("link").href ?? ""));
    }
  };

  const applyLink = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (href.trim().length === 0) {
      setValidationError("Enter a link");
      return;
    }
    const applied = editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: normalizeLinkHref(href) })
      .run();
    if (!applied) {
      setValidationError("Enter a valid link");
      return;
    }
    setIsOpen(false);
  };

  const removeLink = (): void => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setIsOpen(false);
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={isOpen}>
      <PopoverTrigger
        render={
          <Button
            aria-label="Link"
            aria-pressed={isActive}
            disabled={disabled}
            size="icon"
            title="Link"
            type="button"
            variant={isActive ? "secondary" : "ghost"}
          />
        }
      >
        <LinkIcon />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 gap-1.5 p-2"
        initialFocus={inputRef}
        side="top"
      >
        <form className="flex flex-col gap-1.5" onSubmit={applyLink}>
          <InputGroup>
            <InputGroupInput
              aria-invalid={validationError.length > 0}
              aria-label="Link address"
              onChange={(event) => {
                setHref(event.target.value);
                setValidationError("");
              }}
              placeholder="https://example.com"
              ref={inputRef}
              value={href}
            />
            <InputGroupAddon align="inline-end" className="gap-0.5 pr-1">
              {isActive ? (
                <InputGroupButton onClick={removeLink}>Remove</InputGroupButton>
              ) : null}
              <InputGroupButton type="submit" variant="secondary">
                Apply
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {validationError.length > 0 ? (
            <p className="text-destructive px-1">{validationError}</p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
};

export default EmailComposerLinkButton;
