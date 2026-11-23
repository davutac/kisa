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
import { Toggle } from "@/components/ui/toggle";
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from "@/components/ui/toolbar";

interface EmailComposerToolbarProps {
  actions?: ReactNode;
  disabled?: boolean;
  editor: Editor | null;
}

interface FormatToggleProps {
  children: ReactNode;
  label: string;
  onToggle: () => void;
  pressed: boolean;
}

const FormatToggle = ({
  children,
  label,
  onToggle,
  pressed,
}: FormatToggleProps) => (
  <Toggle
    aria-label={label}
    onPressedChange={onToggle}
    pressed={pressed}
    title={label}
  >
    {children}
  </Toggle>
);

interface FormatButtonProps {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}

const FormatButton = ({
  children,
  disabled,
  label,
  onClick,
}: FormatButtonProps) => (
  <ToolbarButton
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    title={label}
  >
    {children}
  </ToolbarButton>
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
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1">
      <Toolbar
        aria-label="Formatting"
        className="flex-wrap"
        disabled={disabled}
      >
        <FormatToggle
          label="Bold"
          onToggle={() => editor.chain().focus().toggleBold().run()}
          pressed={editorState.isBold}
        >
          <BoldIcon />
        </FormatToggle>
        <FormatToggle
          label="Italic"
          onToggle={() => editor.chain().focus().toggleItalic().run()}
          pressed={editorState.isItalic}
        >
          <ItalicIcon />
        </FormatToggle>
        <FormatToggle
          label="Underline"
          onToggle={() => editor.chain().focus().toggleUnderline().run()}
          pressed={editorState.isUnderline}
        >
          <UnderlineIcon />
        </FormatToggle>
        <FormatToggle
          label="Strikethrough"
          onToggle={() => editor.chain().focus().toggleStrike().run()}
          pressed={editorState.isStrike}
        >
          <StrikethroughIcon />
        </FormatToggle>
        <FormatToggle
          label="Inline code"
          onToggle={() => editor.chain().focus().toggleCode().run()}
          pressed={editorState.isCode}
        >
          <CodeIcon />
        </FormatToggle>
        <EmailComposerLinkButton
          editor={editor}
          isActive={editorState.isLink}
        />
        <ToolbarSeparator />
        <FormatToggle
          label="Bulleted list"
          onToggle={() => editor.chain().focus().toggleBulletList().run()}
          pressed={editorState.isBulletList}
        >
          <ListIcon />
        </FormatToggle>
        <FormatToggle
          label="Numbered list"
          onToggle={() => editor.chain().focus().toggleOrderedList().run()}
          pressed={editorState.isOrderedList}
        >
          <ListOrderedIcon />
        </FormatToggle>
        <FormatToggle
          label="Quote"
          onToggle={() => editor.chain().focus().toggleBlockquote().run()}
          pressed={editorState.isBlockquote}
        >
          <QuoteIcon />
        </FormatToggle>
        <FormatToggle
          label="Code block"
          onToggle={() => editor.chain().focus().toggleCodeBlock().run()}
          pressed={editorState.isCodeBlock}
        >
          <FileCodeIcon />
        </FormatToggle>
        <FormatButton
          label="Horizontal rule"
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        >
          <MinusIcon />
        </FormatButton>
        <ToolbarSeparator />
        <FormatButton
          disabled={!editorState.canUndo}
          label="Undo"
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2Icon />
        </FormatButton>
        <FormatButton
          disabled={!editorState.canRedo}
          label="Redo"
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2Icon />
        </FormatButton>
      </Toolbar>
      {actions === undefined ? null : (
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      )}
    </div>
  );
};

export default EmailComposerToolbar;
