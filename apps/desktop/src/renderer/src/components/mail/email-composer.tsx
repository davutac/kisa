import { Placeholder } from "@tiptap/extensions";
import { Fragment } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { EditorContent, Extension, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { ComposerInlineImageNode } from "@/components/mail/composer-inline-images";
import type { ComposerInlineImage } from "@/components/mail/composer-inline-images";
import EmailComposerToolbar from "@/components/mail/email-composer-toolbar";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import { resetEditorHistory } from "@/editor/reset-history";
import { cn } from "@/lib/utils";
import type { GoogleAccount } from "@/shared/ipc/auth";
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
  focusAtStart?: boolean;
  getInlineImagePreview?: (contentId: string) => string | null;
  loadInlineImagePreview?: (contentId: string) => Promise<string | null>;
  enableTemplateVariables?: boolean;
  onApplyTemplate?: (template: ComposerTemplateInput) => void;
  onChange?: (value: EmailComposerValue) => void;
  onComposerFiles?: (
    files: readonly File[]
  ) => Promise<readonly ComposerInlineImage[]>;
  onInlineImageInsertDiscard?: (contentIds: readonly string[]) => void;
  onInlineImageInsertFailure?: (contentIds: readonly string[]) => void;
  placeholder?: string;
  templateFallbackAccountId?: string;
  templateAccounts?: readonly GoogleAccount[];
  templateVariablePreviewContext?: Omit<TemplateVariableContext, "now">;
  templates?: readonly ComposerTemplate[];
  toolbarHeader?: ReactNode;
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
const NO_ACCOUNTS: readonly GoogleAccount[] = [];
const NO_INLINE_IMAGE_PREVIEW = (): null => null;
const NO_INLINE_IMAGE_PREVIEW_LOAD = (): Promise<null> => Promise.resolve(null);

const insertComposerFiles = async (
  view: EditorView,
  files: readonly File[],
  position: number,
  isCurrentContent: () => boolean,
  onComposerFiles: NonNullable<EmailComposerProps["onComposerFiles"]>,
  onInlineImageInsertDiscard:
    | EmailComposerProps["onInlineImageInsertDiscard"]
    | undefined,
  onInlineImageInsertFailure:
    | EmailComposerProps["onInlineImageInsertFailure"]
    | undefined
): Promise<void> => {
  const originalDocument = view.state.doc;
  const images = await onComposerFiles(files);
  if (images.length === 0) {
    return;
  }

  const contentIds = images.map(({ contentId }) => contentId);
  if (view.isDestroyed || !isCurrentContent()) {
    onInlineImageInsertDiscard?.(contentIds);
    return;
  }
  if (view.state.doc !== originalDocument) {
    onInlineImageInsertFailure?.(contentIds);
    return;
  }

  try {
    const nodes = images.map(({ contentId, filename }) =>
      view.state.schema.nodeFromJSON({
        attrs: { contentId, filename },
        type: "composerInlineImage",
      })
    );
    const insertAt = Math.min(position, view.state.doc.content.size);
    view.dispatch(
      view.state.tr.insert(insertAt, Fragment.fromArray(nodes)).scrollIntoView()
    );
  } catch {
    onInlineImageInsertFailure?.(contentIds);
  }
};

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
  focusAtStart = false,
  getInlineImagePreview = NO_INLINE_IMAGE_PREVIEW,
  loadInlineImagePreview = NO_INLINE_IMAGE_PREVIEW_LOAD,
  onApplyTemplate,
  onChange,
  onComposerFiles,
  onInlineImageInsertDiscard,
  onInlineImageInsertFailure,
  placeholder = "Write a message",
  templateFallbackAccountId = "",
  templateAccounts = NO_ACCOUNTS,
  templateVariablePreviewContext,
  templates = NO_TEMPLATES,
  toolbarHeader,
  toolbarActions,
}: EmailComposerProps) => {
  const contentKeyRef = useRef(contentKey);
  const [editorContent, setEditorContent] = useState(defaultValue);
  const editorProps = useMemo(
    () => ({
      attributes: {
        "aria-label": ariaLabel,
        class:
          "flex-1 px-4 py-2 text-sm leading-relaxed outline-none select-text",
      },
      handleDrop:
        onComposerFiles === undefined
          ? undefined
          : (view: EditorView, event: DragEvent) => {
              const files = [...(event.dataTransfer?.files ?? [])];
              if (files.length === 0) {
                return false;
              }
              event.preventDefault();
              const position =
                view.posAtCoords({ left: event.clientX, top: event.clientY })
                  ?.pos ?? view.state.selection.from;
              void insertComposerFiles(
                view,
                files,
                position,
                () => contentKeyRef.current === contentKey,
                onComposerFiles,
                onInlineImageInsertDiscard,
                onInlineImageInsertFailure
              );
              return true;
            },
    }),
    [
      ariaLabel,
      contentKey,
      onComposerFiles,
      onInlineImageInsertDiscard,
      onInlineImageInsertFailure,
    ]
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
      ComposerInlineImageNode.configure({
        getPreviewUrl: getInlineImagePreview,
        loadPreviewUrl: loadInlineImagePreview,
      }),
      enableTemplateVariables ? TemplateVariable : TemplateVariableDisplay,
      ...(enableTemplateSlashMenu ? [TemplateSlashCommand] : []),
      ...(consumeModEnter ? [ComposerSendHotkeyGuard] : []),
    ],
    [
      consumeModEnter,
      enableTemplateSlashMenu,
      enableTemplateVariables,
      getInlineImagePreview,
      loadInlineImagePreview,
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
          templateAccounts,
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
    templateAccounts,
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
            focus: () =>
              editor.commands.focus(focusAtStart ? "start" : "end", {
                scrollIntoView: false,
              }),
            replaceContent: (content) => {
              editor.commands.setContent(content);
              editor.commands.focus("end", { scrollIntoView: false });
            },
          }
    );

    return () => focusHandleRef?.(null);
  }, [editor, focusAtStart, focusHandleRef]);

  return (
    <div
      className={cn(
        "email-composer bg-card border-background flex flex-col overflow-hidden border-y",
        disabled && "opacity-50",
        className
      )}
    >
      <EditorContent
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        data-composer-drop-target=""
        editor={editor}
      />
      {toolbarHeader}
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
