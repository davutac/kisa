import type { Editor } from "@tiptap/core";
import { BracesIcon } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSearch,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  readonly field: "message" | "subject";
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
      <CommandGroup key={group}>
        <CommandGroupLabel>{group}</CommandGroupLabel>
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
              keywords={[expression, description, preview]}
              label={label}
              onSelect={() => onSelect(expression)}
              value={expression}
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
              <span className="text-muted-foreground group-data-highlighted/command-item:text-foreground ml-auto flex max-w-48 shrink-0 flex-col items-end gap-0.5 text-right text-[0.625rem]">
                <span className="text-[9px] font-medium tracking-wide uppercase">
                  Preview
                </span>
                <span
                  className="text-foreground max-w-full truncate text-xs"
                  title={preview}
                >
                  {preview}
                </span>
              </span>
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
  field,
  previewContext,
}: TemplateVariablePickerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [previewNow, setPreviewNow] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const label = `Insert variable in ${field}`;

  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      returnFocusRef.current = triggerRef.current;
      setPreviewNow(Date.now());
    }
    setIsOpen(nextOpen);
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
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogTrigger
        aria-label={label}
        disabled={disabled}
        render={
          <Button
            ref={triggerRef}
            size="icon"
            title={label}
            type="button"
            variant="ghost"
          />
        }
      >
        <BracesIcon />
      </DialogTrigger>
      <DialogHeader className="sr-only">
        <DialogTitle>{label}</DialogTitle>
        <DialogDescription>
          Search template variables and preview their current values.
        </DialogDescription>
      </DialogHeader>
      <DialogContent
        className="top-[calc(var(--app-titlebar-height)+1rem)] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        finalFocus={() => returnFocusRef.current}
        initialFocus={() => searchInputRef.current}
        showCloseButton={false}
      >
        <Command loop>
          <CommandSearch>
            <CommandInput
              aria-label="Search variables"
              onEscape={() => setIsOpen(false)}
              placeholder="Search variables"
              ref={searchInputRef}
            />
          </CommandSearch>
          <CommandEmpty>No variable answers to that name.</CommandEmpty>
          <CommandList className="max-h-96 px-1 py-2">
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
  );
};
