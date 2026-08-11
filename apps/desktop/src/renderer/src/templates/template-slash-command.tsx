// forwardRef must be assigned so Tiptap's ReactRenderer can retain its ref type.
// oxlint-disable react/function-component-definition
import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import { ReactRenderer } from "@tiptap/react";
import { Suggestion } from "@tiptap/suggestion";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import type { ComposerTemplate } from "@/shared/ipc/templates";

const MAX_TEMPLATE_SUGGESTIONS = 8;
const TEMPLATE_SLASH_PLUGIN_KEY = new PluginKey("composerTemplateSlashMenu");

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

interface TemplateSlashMenuHandle {
  readonly onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

type TemplateSlashMenuProps = SuggestionProps<
  ComposerTemplate,
  ComposerTemplate
>;

const TemplateSlashMenu = forwardRef<
  TemplateSlashMenuHandle,
  TemplateSlashMenuProps
>(({ command, items }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedItemRef = useRef<HTMLButtonElement>(null);
  const activeIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) {
          return false;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((current) => (current + 1) % items.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (current) => (current - 1 + items.length) % items.length
          );
          return true;
        }
        if (event.key === "Enter") {
          const selected = items[activeIndex];
          if (selected !== undefined) {
            command(selected);
          }
          return true;
        }
        return false;
      },
    }),
    [activeIndex, command, items]
  );

  return (
    <div
      aria-label="Templates"
      className="bg-popover text-popover-foreground ring-foreground/10 z-[60] max-h-40 min-w-56 overflow-y-auto overscroll-contain rounded-lg p-1 shadow-lg ring-1"
      role="menu"
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground px-2 py-1.5 text-xs">
          No template answers to that name.
        </p>
      ) : (
        items.map((template, index) => (
          <button
            className={cn(
              "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left outline-none",
              index === activeIndex && "bg-foreground/10"
            )}
            key={template.id}
            onClick={() => command(template)}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setSelectedIndex(index)}
            ref={index === activeIndex ? selectedItemRef : undefined}
            role="menuitem"
            type="button"
          >
            <span className="max-w-72 truncate text-sm font-medium">
              {template.name}
            </span>
            {template.subject.length === 0 ? null : (
              <span className="text-muted-foreground max-w-72 truncate text-xs">
                {template.subject}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
});
TemplateSlashMenu.displayName = "TemplateSlashMenu";
type TemplateSlashMenuComponentProps = ComponentProps<typeof TemplateSlashMenu>;

interface TemplateSlashCommandBinding {
  readonly getTemplates: () => readonly ComposerTemplate[];
  readonly onSelect: (
    template: ComposerTemplate,
    editor: Editor,
    range: { readonly from: number; readonly to: number }
  ) => void;
}

const bindings = new WeakMap<Editor, TemplateSlashCommandBinding>();

export const configureTemplateSlashCommand = (
  editor: Editor,
  binding: TemplateSlashCommandBinding
): (() => void) => {
  bindings.set(editor, binding);
  return () => {
    if (bindings.get(editor) === binding) {
      bindings.delete(editor);
    }
  };
};

export const TemplateSlashCommand = Extension.create({
  addProseMirrorPlugins() {
    return [
      Suggestion<ComposerTemplate, ComposerTemplate>({
        allow: ({ state, range }) => {
          const position = state.doc.resolve(range.from);
          return position.parent.type.name === "paragraph";
        },
        allowedPrefixes: [" "],
        char: "/",
        command: ({ editor, props, range }) =>
          bindings.get(editor)?.onSelect(props, editor, range),
        container: '[data-slot="dialog-content"]',
        editor: this.editor,
        items: ({ editor, query }) =>
          filterTemplateSuggestions(
            bindings.get(editor)?.getTemplates() ?? [],
            query
          ),
        pluginKey: TEMPLATE_SLASH_PLUGIN_KEY,
        render: () => {
          let component:
            | ReactRenderer<
                TemplateSlashMenuHandle,
                TemplateSlashMenuComponentProps
              >
            | undefined;
          let unmount: (() => void) | undefined;

          return {
            onExit: () => {
              unmount?.();
              component?.destroy();
              component = undefined;
              unmount = undefined;
            },
            onKeyDown: (props) => component?.ref?.onKeyDown(props) ?? false,
            onStart: (props) => {
              const renderer = new ReactRenderer(TemplateSlashMenu, {
                editor: props.editor,
                props,
              });
              component = renderer;
              unmount = props.mount(renderer.element);
            },
            onUpdate: (props) => {
              component?.updateProps(props);
            },
          };
        },
      }),
    ];
  },
  name: "composerTemplateSlashCommand",
});
