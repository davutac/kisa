import { Placeholder } from "@tiptap/extensions";
import { EditorContent, Extension, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import EmailComposerToolbar from "@/components/mail/email-composer-toolbar";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import { resetEditorHistory } from "@/editor/reset-history";
import { cn } from "@/lib/utils";
import type {
  ComposerTemplate,
  ComposerTemplateInput,
} from "@/shared/ipc/templates";
import type { TemplateVariableContext } from "@/shared/template-variables";
import { resolveTemplateText } from "@/shared/template-variables";
import { createTemplateVariableContext } from "@/templates/apply-composer-template";
import {
  configureTemplateSlashCommand,
  TemplateSlashCommand,
} from "@/templates/template-slash-command";
import {
  resolveTemplateVariableContent,
  TemplateVariable,
  TemplateVariableDisplay,
} from "@/templates/template-variable";
import { TemplateVariablePicker } from "@/templates/template-variable-picker";

export interface EmailComposerValue {
  html: string;
  isEmpty: boolean;
  text: string;
}

interface EmailComposerProps {
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  consumeModEnter?: boolean;
  contentKey?: string;
  defaultValue?: string;
  disabled?: boolean;
  enableTemplateSlashMenu?: boolean;
  focusHandleRef?: (handle: ComposerFocusHandle | null) => void;
  enableTemplateVariables?: boolean;
  onApplyTemplate?: (template: ComposerTemplateInput) => void;
  onChange?: (value: EmailComposerValue) => void;
  placeholder?: string;
  templateFallbackAccountId?: string;
  templateVariablePreviewContext?: Omit<TemplateVariableContext, "now">;
  templates?: readonly ComposerTemplate[];
  toolbarActions?: ReactNode;
}

export const getComposerSendKeyboardShortcuts = () => ({
  "Mod-Enter": () => true,
});

export const ComposerSendHotkeyGuard = Extension.create({
  addKeyboardShortcuts() {
    return getComposerSendKeyboardShortcuts();
  },
  name: "composerSendHotkeyGuard",
  priority: 1000,
});

const toComposerValue = (
  editor: NonNullable<ReturnType<typeof useEditor>>
): EmailComposerValue => ({
  html: editor.getHTML(),
  isEmpty: editor.isEmpty,
  text: editor.getText(),
});

const NO_TEMPLATES: readonly ComposerTemplate[] = [];

const resolveComposerTemplate = (
  editor: NonNullable<ReturnType<typeof useEditor>>,
  template: ComposerTemplate,
  context: TemplateVariableContext
): ComposerTemplateInput | undefined => {
  const subject = resolveTemplateText(template.subject, context);
  if (!subject.ok) {
    toast.error(`Subject: ${subject.message}`);
    return undefined;
  }

  const previousContent = editor.getJSON();
  editor.commands.setContent(template.body.html, { emitUpdate: false });
  const body = resolveTemplateVariableContent(editor.getJSON(), context);
  if (!body.ok) {
    editor.commands.setContent(previousContent, { emitUpdate: false });
    toast.error(`Body: ${body.message}`);
    return undefined;
  }

  editor.commands.setContent(body.value ?? "", { emitUpdate: false });
  resetEditorHistory(editor);
  const resolvedBody = toComposerValue(editor);

  return {
    accountId: template.accountId,
    bcc: template.bcc,
    body: { html: resolvedBody.html, text: resolvedBody.text },
    cc: template.cc,
    id: template.id,
    name: template.name,
    subject: subject.value,
    to: template.to,
  };
};

const EmailComposer = ({
  ariaLabel = "Message",
  autoFocus = false,
  className,
  consumeModEnter = false,
  contentKey,
  defaultValue = "",
  disabled = false,
  enableTemplateSlashMenu = false,
  enableTemplateVariables = false,
  focusHandleRef,
  onApplyTemplate,
  onChange,
  placeholder = "Write a message",
  templateFallbackAccountId = "",
  templateVariablePreviewContext,
  templates = NO_TEMPLATES,
  toolbarActions,
}: EmailComposerProps) => {
  const contentKeyRef = useRef(contentKey);
  const [editorContent, setEditorContent] = useState(defaultValue);
  const editorProps = useMemo(
    () => ({
      attributes: {
        "aria-label": ariaLabel,
        class:
          "min-h-full px-4 py-2 text-sm leading-relaxed outline-none select-text",
      },
    }),
    [ariaLabel]
  );
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        heading: false,
        link: {
          openOnClick: false,
        },
      }),
      Placeholder.configure({ placeholder }),
      enableTemplateVariables ? TemplateVariable : TemplateVariableDisplay,
      ...(enableTemplateSlashMenu ? [TemplateSlashCommand] : []),
      ...(consumeModEnter ? [ComposerSendHotkeyGuard] : []),
    ],
    [
      consumeModEnter,
      enableTemplateSlashMenu,
      enableTemplateVariables,
      placeholder,
    ]
  );

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    content: editorContent,
    editable: !disabled,
    editorProps,
    extensions,
    onUpdate: ({ editor: currentEditor }) => {
      onChange?.(toComposerValue(currentEditor));
    },
    shouldRerenderOnTransaction: false,
  });

  useEffect(() => {
    const editable = !disabled;
    if (editor !== null && editor.isEditable !== editable) {
      editor.setEditable(editable, false);
    }
  }, [disabled, editor]);

  useEffect(() => {
    if (!(editor && enableTemplateSlashMenu)) {
      return;
    }

    return configureTemplateSlashCommand(editor, {
      getTemplates: () => templates,
      onSelect: (template, currentEditor, range) => {
        currentEditor.chain().focus().deleteRange(range).run();
        const context = createTemplateVariableContext(
          templateFallbackAccountId,
          template,
          Date.now()
        );
        const resolved = resolveComposerTemplate(
          currentEditor,
          template,
          context
        );
        if (resolved !== undefined) {
          onApplyTemplate?.(resolved);
        }
      },
    });
  }, [
    editor,
    enableTemplateSlashMenu,
    onApplyTemplate,
    templateFallbackAccountId,
    templates,
  ]);

  useLayoutEffect(() => {
    if (editor === null || contentKeyRef.current === contentKey) {
      return;
    }

    contentKeyRef.current = contentKey;
    setEditorContent(defaultValue);
    editor.commands.setContent(defaultValue, { emitUpdate: false });

    // A new editor state keeps undo history from crossing draft boundaries.
    resetEditorHistory(editor);
  }, [contentKey, defaultValue, editor]);

  useLayoutEffect(() => {
    const element = editor?.view.dom ?? null;
    focusHandleRef?.(
      element === null || editor === null
        ? null
        : {
            element,
            focus: () => editor.commands.focus("end"),
          }
    );

    return () => focusHandleRef?.(null);
  }, [editor, focusHandleRef]);

  return (
    <div
      className={cn(
        "email-composer bg-card border-background flex flex-col overflow-hidden border-y",
        disabled && "opacity-50",
        className
      )}
    >
      <EditorContent
        className="min-h-0 flex-1 overflow-y-auto"
        editor={editor}
      />
      <EmailComposerToolbar
        actions={
          enableTemplateVariables ? (
            <>
              <TemplateVariablePicker
                disabled={disabled}
                editor={editor}
                previewContext={templateVariablePreviewContext}
              />
              {toolbarActions}
            </>
          ) : (
            toolbarActions
          )
        }
        disabled={disabled}
        editor={editor}
      />
    </div>
  );
};

export default EmailComposer;
