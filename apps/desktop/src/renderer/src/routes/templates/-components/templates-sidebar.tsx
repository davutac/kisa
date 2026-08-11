import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getHotkeyAriaLabel, getHotkeyDisplay } from "@/hotkeys";
import { cn } from "@/lib/utils";
import type { ComposerTemplate } from "@/shared/ipc/templates";

import { getTemplateSummary } from "./template-draft";

interface TemplatesSidebarProps {
  readonly isLoading: boolean;
  readonly onCreate: () => void;
  readonly onQueryChange: (query: string) => void;
  readonly onSelect: (template: ComposerTemplate) => void;
  readonly query: string;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly selectedTemplateId?: string;
  readonly templates: readonly ComposerTemplate[];
  readonly totalTemplateCount: number;
}

const TemplatesSidebar = ({
  isLoading,
  onCreate,
  onQueryChange,
  onSelect,
  query,
  searchInputRef,
  selectedTemplateId,
  templates,
  totalTemplateCount,
}: TemplatesSidebarProps) => {
  const newTemplateDisplay = getHotkeyDisplay("templates.new");
  const searchDisplay = getHotkeyDisplay("templates.focusSearch");
  const selectedTemplateRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    selectedTemplateRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedTemplateId, templates]);

  let content;
  if (isLoading) {
    content = (
      <div className="text-muted-foreground flex items-center gap-2 p-3 text-sm">
        <LoaderCircleIcon className="animate-spin" /> Loading templates…
      </div>
    );
  } else if (templates.length === 0) {
    content = (
      <p className="text-muted-foreground p-3 text-sm">
        {totalTemplateCount === 0
          ? "No templates yet"
          : "No matching templates"}
      </p>
    );
  } else {
    content = templates.map((template) => (
      <button
        className={cn(
          "hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col items-start rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2",
          selectedTemplateId === template.id && "bg-muted"
        )}
        key={template.id}
        onClick={() => onSelect(template)}
        ref={
          selectedTemplateId === template.id ? selectedTemplateRef : undefined
        }
        type="button"
      >
        <span className="w-full truncate text-sm font-medium">
          {template.name}
        </span>
        <span className="text-muted-foreground w-full truncate text-xs">
          {getTemplateSummary(template)}
        </span>
      </button>
    ));
  }

  return (
    <aside className="bg-background flex w-72 shrink-0 flex-col gap-px overflow-hidden rounded-xl">
      <div className="bg-card flex items-center justify-between gap-2 px-4 pt-4 pb-2">
        <div>
          <h1
            className="font-heading text-base font-medium"
            id="templates-title"
          >
            Templates
          </h1>
          <p className="text-muted-foreground text-xs">
            Insert with / in a new email
          </p>
        </div>
        <Button
          aria-keyshortcuts={getHotkeyAriaLabel("templates.new")}
          aria-label={newTemplateDisplay.label}
          onClick={onCreate}
          size="icon"
          title={`${newTemplateDisplay.label} (${newTemplateDisplay.bindings[0]})`}
          type="button"
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="bg-card px-3 py-2">
        <Input
          aria-keyshortcuts={getHotkeyAriaLabel("templates.focusSearch")}
          aria-label={searchDisplay.label}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search templates"
          ref={searchInputRef}
          type="search"
          value={query}
        />
      </div>
      <div
        aria-keyshortcuts={`${getHotkeyAriaLabel("templates.next")} ${getHotkeyAriaLabel("templates.previous")}`}
        aria-label="Template list"
        className="bg-card flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2"
      >
        {content}
      </div>
    </aside>
  );
};

export default TemplatesSidebar;
