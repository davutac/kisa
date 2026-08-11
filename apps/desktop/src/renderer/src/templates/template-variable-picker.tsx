import type { Editor } from "@tiptap/core";
import { BracesIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TemplateVariableContext } from "@/shared/template-variables";
import {
  listTemplateVariableInsertions,
  resolveTemplateVariableExpression,
} from "@/shared/template-variables";

const TEMPLATE_VARIABLE_INSERTIONS = listTemplateVariableInsertions();
const TEMPLATE_VARIABLE_GROUPS = [
  ...new Set(TEMPLATE_VARIABLE_INSERTIONS.map(({ group }) => group)),
];

interface TemplateVariablePickerProps {
  readonly disabled: boolean;
  readonly editor: Editor | null;
  readonly previewContext?: Omit<TemplateVariableContext, "now">;
}

interface TemplateVariableCommandItemsProps {
  readonly context: TemplateVariableContext;
  readonly onSelect: (expression: string) => void;
}

export const TemplateVariableCommandItems = ({
  context,
  onSelect,
}: TemplateVariableCommandItemsProps) => (
  <>
    {TEMPLATE_VARIABLE_GROUPS.map((group) => (
      <CommandGroup heading={group} key={group}>
        {TEMPLATE_VARIABLE_INSERTIONS.filter(
          (insertion) => insertion.group === group
        ).map((insertion) => {
          const { description, emptyPreview, expression, label } = insertion;
          const resolved = resolveTemplateVariableExpression(
            expression,
            context
          );
          const preview = resolved.ok
            ? resolved.value || emptyPreview || "Empty value"
            : resolved.message;

          return (
            <CommandItem
              className="h-auto items-start gap-4 py-2"
              key={expression}
              onSelect={() => onSelect(expression)}
              value={[label, expression, description, preview].join(" ")}
            >
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-medium">{label}</span>
                <code className="text-muted-foreground text-[10px]">
                  {`{{${expression}}}`}
                </code>
                <span className="text-muted-foreground text-[10px]">
                  {description}
                </span>
              </span>
              <CommandShortcut className="flex max-w-48 shrink-0 flex-col items-end gap-0.5 text-right tracking-normal">
                <span className="text-[9px] font-medium tracking-wide uppercase">
                  Preview
                </span>
                <span
                  className="text-foreground max-w-full truncate text-xs"
                  title={preview}
                >
                  {preview}
                </span>
              </CommandShortcut>
            </CommandItem>
          );
        })}
      </CommandGroup>
    ))}
  </>
);

export const TemplateVariablePicker = ({
  disabled,
  editor,
  previewContext,
}: TemplateVariablePickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [previewNow, setPreviewNow] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const open = (): void => {
    returnFocusRef.current = triggerRef.current;
    setPreviewNow(Date.now());
    setIsOpen(true);
  };

  const insert = (expression: string): void => {
    if (editor !== null) {
      editor
        .chain()
        .insertContent({
          attrs: { expression },
          type: "templateVariable",
        })
        .run();
      returnFocusRef.current = editor.view.dom;
    }
    setIsOpen(false);
  };

  return (
    <>
      <Button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Insert variable"
        disabled={disabled}
        onClick={open}
        ref={triggerRef}
        size="icon"
        title="Insert variable"
        type="button"
        variant="ghost"
      >
        <BracesIcon />
      </Button>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogHeader className="sr-only">
          <DialogTitle>Insert variable</DialogTitle>
          <DialogDescription>
            Search template variables and preview their current values.
          </DialogDescription>
        </DialogHeader>
        <DialogContent
          className="top-[calc(var(--app-titlebar-height)+1rem)] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
          finalFocus={() => returnFocusRef.current}
          initialFocus={searchInputRef}
          showCloseButton={false}
        >
          <Command key={isOpen ? "open" : "closed"} loop>
            <CommandInput placeholder="Search variables" ref={searchInputRef} />
            <CommandList className="max-h-96 px-1 py-2">
              <CommandEmpty>No variable answers to that name.</CommandEmpty>
              <TemplateVariableCommandItems
                context={{ ...previewContext, now: previewNow }}
                onSelect={insert}
              />
            </CommandList>
            <div className="text-muted-foreground bg-card border-border/40 flex items-center gap-3 border-t px-4 py-2 text-[0.625rem]">
              <span>↑↓ navigate</span>
              <span>↵ insert</span>
              <span>esc close</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
};
