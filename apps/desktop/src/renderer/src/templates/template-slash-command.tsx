import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { TriggerDefinition } from "@ui-sdk/react/trigger-menu";

import {
  TriggerMenu,
  TriggerMenuContent,
  TriggerMenuEmpty,
  TriggerMenuItem,
  TriggerMenuList,
  TriggerMenuStatus,
} from "@/components/ui/trigger-menu";
import { useTiptapTriggerMenu } from "@/editor/use-tiptap-trigger-menu";
import type { ComposerTemplate } from "@/shared/ipc/templates";

const MAX_TEMPLATE_SUGGESTIONS = 8;
// A query runs to the next space or slash, like the editor's other suggestions.
const TRIGGERS: TriggerDefinition[] = [{ char: "/", pattern: /[^\s/]/u }];
const ADAPTER_OPTIONS = {
  allows: (textblock: ProseMirrorNode) => textblock.type.name === "paragraph",
};
// Leaf nodes, like a variable or a line break, read as U+FFFC.
const FOLLOWS_SPACE = /^$|[\s\uFFFC]$/u;

export const filterTemplateSuggestions = (
  templates: readonly ComposerTemplate[],
  query: string
): ComposerTemplate[] => {
  const normalized = query.trim().toLocaleLowerCase();

  return templates
    .filter(({ name }) => name.toLocaleLowerCase().includes(normalized))
    .toSorted((left, right) => {
      const leftStarts = left.name.toLocaleLowerCase().startsWith(normalized);
      const rightStarts = right.name.toLocaleLowerCase().startsWith(normalized);
      if (leftStarts !== rightStarts) {
        return leftStarts ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      });
    })
    .slice(0, MAX_TEMPLATE_SUGGESTIONS);
};

interface TemplateSlashMenuProps {
  readonly editor: Editor | null;
  readonly onSelect: (
    template: ComposerTemplate,
    range: { readonly from: number; readonly to: number }
  ) => void;
  readonly templates: readonly ComposerTemplate[];
}

export const TemplateSlashMenu = ({
  editor,
  onSelect,
  templates,
}: TemplateSlashMenuProps) => {
  const menu = useTiptapTriggerMenu(editor, ADAPTER_OPTIONS);

  return (
    <TriggerMenu
      controller={menu.controller}
      editor={menu.adapter}
      onOpenChange={(open, details) => {
        const start = menu.controller.getMatch()?.start;
        if (open && editor !== null && start !== undefined) {
          const before = editor.state.doc.textBetween(
            start - 1,
            start,
            "\n",
            "\uFFFC"
          );
          if (!FOLLOWS_SPACE.test(before)) {
            details.cancel();
            return;
          }
        }
        menu.onOpenChange(open, details);
      }}
      onSelect={(templateId, details) => {
        details.preventDefault();
        const template = templates.find(({ id }) => id === templateId);
        if (template !== undefined) {
          onSelect(template, {
            from: details.match.start,
            to: details.match.end,
          });
        }
      }}
      triggers={TRIGGERS}
    >
      <TriggerMenuStatus />
      {/* Kept mounted so agents find the menu by its list's name. */}
      <TriggerMenuContent keepMounted>
        <TriggerMenuEmpty>No template answers to that name.</TriggerMenuEmpty>
        <TriggerMenuList aria-label="Templates">
          {(state) =>
            filterTemplateSuggestions(templates, state.query).map(
              (template) => (
                <TriggerMenuItem
                  key={template.id}
                  label={template.name}
                  value={template.id}
                >
                  <span className="max-w-72 truncate text-sm font-medium">
                    {template.name}
                  </span>
                  {template.subject.length === 0 ? null : (
                    <span className="text-muted-foreground max-w-72 truncate text-xs">
                      {template.subject}
                    </span>
                  )}
                </TriggerMenuItem>
              )
            )
          }
        </TriggerMenuList>
      </TriggerMenuContent>
    </TriggerMenu>
  );
};
