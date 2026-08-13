import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import {
  BoldIcon,
  CodeIcon,
  FileCodeIcon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  QuoteIcon,
  Redo2Icon,
  StrikethroughIcon,
  UnderlineIcon,
  Undo2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import EmailComposerLinkButton from "@/components/mail/email-composer-link-button";
import { Button } from "@/components/ui/button";

interface EmailComposerToolbarProps {
  actions?: ReactNode;
  disabled?: boolean;
  editor: Editor | null;
}

interface ToolbarButtonProps {
  active?: boolean;
  children: ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}

const ToolbarSeparator = () => (
  <span aria-hidden className="bg-border mx-1 h-4 w-px" />
);

const ToolbarButton = ({
  active,
  children,
  disabled,
  label,
  onClick,
}: ToolbarButtonProps) => (
  <Button
    aria-label={label}
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    size="icon"
    title={label}
    type="button"
    variant={active ? "secondary" : "ghost"}
  >
    {children}
  </Button>
);

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
        isCode: currentEditor.isActive("code"),
        isCodeBlock: currentEditor.isActive("codeBlock"),
        isItalic: currentEditor.isActive("italic"),
        isLink: currentEditor.isActive("link"),
        isOrderedList: currentEditor.isActive("orderedList"),
        isStrike: currentEditor.isActive("strike"),
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
      <ToolbarButton
        active={editorState.isBold}
        disabled={disabled}
        label="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <BoldIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isItalic}
        disabled={disabled}
        label="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <ItalicIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isUnderline}
        disabled={disabled}
        label="Underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isStrike}
        disabled={disabled}
        label="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <StrikethroughIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isCode}
        disabled={disabled}
        label="Inline code"
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <CodeIcon />
      </ToolbarButton>
      <EmailComposerLinkButton
        disabled={disabled}
        editor={editor}
        isActive={editorState.isLink}
      />
      <ToolbarSeparator />
      <ToolbarButton
        active={editorState.isBulletList}
        disabled={disabled}
        label="Bulleted list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <ListIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isOrderedList}
        disabled={disabled}
        label="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrderedIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isBlockquote}
        disabled={disabled}
        label="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <QuoteIcon />
      </ToolbarButton>
      <ToolbarButton
        active={editorState.isCodeBlock}
        disabled={disabled}
        label="Code block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <FileCodeIcon />
      </ToolbarButton>
      <ToolbarButton
        disabled={disabled}
        label="Horizontal rule"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <MinusIcon />
      </ToolbarButton>
      <ToolbarSeparator />
      <ToolbarButton
        disabled={disabled || !editorState.canUndo}
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2Icon />
      </ToolbarButton>
      <ToolbarButton
        disabled={disabled || !editorState.canRedo}
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2Icon />
      </ToolbarButton>
      {actions === undefined ? null : (
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      )}
    </div>
  );
};

export default EmailComposerToolbar;
