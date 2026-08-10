import { Placeholder } from "@tiptap/extensions";
import { EditorState, Selection } from "@tiptap/pm/state";
import { EditorContent, Extension, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

import EmailComposerToolbar from "@/components/mail/email-composer-toolbar";
import type { ComposerFocusHandle } from "@/components/mail/use-composer-focus";
import { cn } from "@/lib/utils";

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
  focusHandleRef?: (handle: ComposerFocusHandle | null) => void;
  onChange?: (value: EmailComposerValue) => void;
  placeholder?: string;
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

const EmailComposer = ({
  ariaLabel = "Message",
  autoFocus = false,
  className,
  consumeModEnter = false,
  contentKey,
  defaultValue = "",
  disabled = false,
  focusHandleRef,
  onChange,
  placeholder = "Write a message",
  toolbarActions,
}: EmailComposerProps) => {
  const contentKeyRef = useRef(contentKey);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const editor = useEditor({
    autofocus: autoFocus ? "end" : false,
    content: defaultValue,
    editable: !disabled,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class:
          "min-h-32 px-4 py-2 text-sm leading-relaxed outline-none select-text",
      },
    },
    extensions: [
      StarterKit.configure({
        heading: false,
        link: {
          openOnClick: false,
        },
      }),
      Placeholder.configure({ placeholder }),
      ...(consumeModEnter ? [ComposerSendHotkeyGuard] : []),
    ],
    onCreate: ({ editor: currentEditor }) => {
      onChangeRef.current?.(toComposerValue(currentEditor));
    },
    onUpdate: ({ editor: currentEditor }) => {
      onChangeRef.current?.(toComposerValue(currentEditor));
    },
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  useLayoutEffect(() => {
    if (editor === null || contentKeyRef.current === contentKey) {
      return;
    }

    contentKeyRef.current = contentKey;
    editor.commands.setContent(defaultValue, { emitUpdate: false });

    // A new editor state keeps undo history from crossing draft boundaries.
    const { doc, plugins } = editor.state;
    editor.view.updateState(
      EditorState.create({
        doc,
        plugins,
        selection: Selection.atEnd(doc),
      })
    );
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
        actions={toolbarActions}
        disabled={disabled}
        editor={editor}
      />
    </div>
  );
};

export default EmailComposer;
