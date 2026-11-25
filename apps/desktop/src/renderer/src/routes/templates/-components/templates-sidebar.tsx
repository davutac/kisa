import { LoaderCircleIcon, SearchIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { getHotkeyAriaLabel, getHotkeyDisplay, HotkeyHint } from "@/hotkeys";
import { cn } from "@/lib/utils";
import type { ComposerTemplate } from "@/shared/ipc/templates";

import { getTemplateSummary } from "./template-draft";

interface TemplatesSidebarProps {
  readonly isLoading: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (template: ComposerTemplate) => void;
  readonly query: string;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly selectedTemplateId?: string;
  readonly templates: readonly ComposerTemplate[];
}

/**
 * The template list beside the editor, set on the page like the app's
 * sidebar rows, with no card or divider around it. The page leaves it out
 * until the first template exists.
 */
const TemplatesSidebar = ({
  isLoading,
  onQueryChange,
  onSelect,
  query,
  searchInputRef,
  selectedTemplateId,
  templates,
}: TemplatesSidebarProps) => {
  const searchDisplay = getHotkeyDisplay("templates.focusSearch");
  const selectedTemplateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedTemplateRef.current?.scrollIntoView({ block: "nearest" });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The selected row is scrolled into view whenever the selection or the list changes.
  }, [selectedTemplateId, templates]);

  let content;
  if (isLoading) {
    content = (
      <p className="text-muted-foreground flex items-center gap-2 px-2.5 py-2 text-[13px]">
        <LoaderCircleIcon className="size-3.5 animate-spin motion-reduce:animate-none" />
        Dusting off templates…
      </p>
    );
  } else if (templates.length === 0) {
    content = (
      <p className="text-muted-foreground px-2.5 py-2 text-[13px]">
        No template answers to that name.
      </p>
    );
  } else {
    const rows = templates.map((template) => {
      const isSelected = selectedTemplateId === template.id;
      const summaryId = `template-${template.id}-summary`;

      return (
        <li className="shrink-0" key={template.id}>
          <Button
            aria-current={isSelected ? "true" : undefined}
            aria-describedby={summaryId}
            aria-label={template.name}
            className={cn(
              "text-foreground/80 hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent flex h-auto w-full flex-col items-start justify-start gap-0.5 px-2.5 py-2 text-left active:not-aria-[haspopup]:translate-y-0",
              isSelected && "bg-accent text-accent-foreground"
            )}
            onClick={() => onSelect(template)}
            ref={isSelected ? selectedTemplateRef : undefined}
            type="button"
            variant="ghost"
          >
            <span
              className={cn(
                "w-full truncate text-[13px]",
                isSelected ? "font-medium" : "font-normal"
              )}
            >
              {template.name}
            </span>{" "}
            <span
              className="text-muted-foreground w-full truncate text-xs"
              id={summaryId}
            >
              {getTemplateSummary(template)}
            </span>
          </Button>
        </li>
      );
    });
    content = (
      <ul
        aria-keyshortcuts={`${getHotkeyAriaLabel("templates.next")} ${getHotkeyAriaLabel("templates.previous")}`}
        aria-label="Template list"
        className="flex flex-col gap-0.5"
      >
        {rows}
      </ul>
    );
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col">
      <div className="shrink-0 pt-1 pb-2 pl-2">
        <InputGroup className="bg-muted/60 dark:bg-muted/60 h-8 border-0 shadow-none">
          <InputGroupAddon>
            <SearchIcon className="stroke-[1.8]" />
          </InputGroupAddon>
          <Input
            aria-keyshortcuts={getHotkeyAriaLabel("templates.focusSearch")}
            aria-label={searchDisplay.label}
            className="text-[13px] md:text-[13px]"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Search templates"
            ref={searchInputRef}
            type="search"
            value={query}
          />
          {query === "" ? (
            <InputGroupAddon align="inline-end">
              <HotkeyHint command="templates.focusSearch" />
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>
      <div className="scroll-fade-y flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2 pl-2">
        {content}
      </div>
      <p className="text-muted-foreground flex shrink-0 items-center gap-1.5 pt-2 pr-2 pb-2 pl-4 text-xs">
        Type <Kbd>/</Kbd> in a new email to insert one
      </p>
    </aside>
  );
};

export default TemplatesSidebar;
