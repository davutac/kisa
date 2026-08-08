import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  BoldIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface EmailComposerToolbarProps {
  actions?: ReactNode;
  disabled?: boolean;
  editor: Editor | null;
}

const EmailComposerToolbar = ({
  actions,
  disabled = false,
  editor,
}: EmailComposerToolbarProps) => {
  const editorState = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      if (!currentEditor) {
        return null;
      }

      return {
        canRedo: currentEditor.can().chain().focus().redo().run(),
        canUndo: currentEditor.can().chain().focus().undo().run(),
        isBlockquote: currentEditor.isActive("blockquote"),
        isBold: currentEditor.isActive("bold"),
        isBulletList: currentEditor.isActive("bulletList"),
        isItalic: currentEditor.isActive("italic"),
        isOrderedList: currentEditor.isActive("orderedList"),
        isUnderline: currentEditor.isActive("underline"),
      };
    },
  });

  if (!(editor && editorState)) {
    return null;
  }

  return (
    <div
      aria-label="Formatting"
      className="border-background flex flex-wrap items-center gap-0.5 border-t px-2 py-1"
      role="toolbar"
    >
      <Button
        aria-label="Bold"
        aria-pressed={editorState.isBold}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
        size="icon"
        title="Bold"
        type="button"
        variant={editorState.isBold ? "secondary" : "ghost"}
      >
        <BoldIcon />
      </Button>
      <Button
        aria-label="Italic"
        aria-pressed={editorState.isItalic}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        size="icon"
        title="Italic"
        type="button"
        variant={editorState.isItalic ? "secondary" : "ghost"}
      >
        <ItalicIcon />
      </Button>
      <Button
        aria-label="Underline"
        aria-pressed={editorState.isUnderline}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        size="icon"
        title="Underline"
        type="button"
        variant={editorState.isUnderline ? "secondary" : "ghost"}
      >
        <UnderlineIcon />
      </Button>
      <span aria-hidden className="bg-border mx-1 h-4 w-px" />
      <Button
        aria-label="Bulleted list"
        aria-pressed={editorState.isBulletList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        size="icon"
        title="Bulleted list"
        type="button"
        variant={editorState.isBulletList ? "secondary" : "ghost"}
      >
        <ListIcon />
      </Button>
      <Button
        aria-label="Numbered list"
        aria-pressed={editorState.isOrderedList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        size="icon"
        title="Numbered list"
        type="button"
        variant={editorState.isOrderedList ? "secondary" : "ghost"}
      >
        <ListOrderedIcon />
      </Button>
      <Button
        aria-label="Quote"
        aria-pressed={editorState.isBlockquote}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        size="icon"
        title="Quote"
        type="button"
        variant={editorState.isBlockquote ? "secondary" : "ghost"}
      >
        <QuoteIcon />
      </Button>
      <span aria-hidden className="bg-border mx-1 h-4 w-px" />
      <Button
        aria-label="Undo"
        disabled={disabled || !editorState.canUndo}
        onClick={() => editor.chain().focus().undo().run()}
        size="icon"
        title="Undo"
        type="button"
        variant="ghost"
      >
        <Undo2Icon />
      </Button>
      <Button
        aria-label="Redo"
        disabled={disabled || !editorState.canRedo}
        onClick={() => editor.chain().focus().redo().run()}
        size="icon"
        title="Redo"
        type="button"
        variant="ghost"
      >
        <Redo2Icon />
      </Button>
      {actions === undefined ? null : (
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      )}
    </div>
  );
};

export default EmailComposerToolbar;
