import type { EditorProps } from "@tiptap/pm/view";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useLayoutEffect, useRef, useState } from "react";

import { InputGroupAddon } from "@/components/ui/input-group";
import { resetEditorHistory } from "@/editor/reset-history";
import type { TemplateVariableContext } from "@/shared/template-variables";
import {
  TemplateVariable,
  templateTextToVariableDocument,
  variableDocumentToTemplateText,
} from "@/templates/template-variable";
import { TemplateVariablePicker } from "@/templates/template-variable-picker";

import {
  TemplateSubjectLimit,
  truncateTemplateSubjectPaste,
} from "./template-subject-limit";

const SUBJECT_EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    bold: false,
    bulletList: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    hardBreak: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    link: false,
    listItem: false,
    listKeymap: false,
    orderedList: false,
    strike: false,
    trailingNode: false,
    underline: false,
  }),
  TemplateVariable,
  TemplateSubjectLimit,
];

const normalizePastedSubject = (value: string): string =>
  value.replaceAll(/\r?\n|\r/gu, " ");

const SUBJECT_EDITOR_PROPS = {
  attributes: {
    "aria-labelledby": "template-subject-label",
    class:
      "no-scrollbar flex h-8 min-w-0 flex-1 items-center overflow-x-auto whitespace-pre text-xs/relaxed outline-none [&>p]:min-w-max [&>p]:pl-0.5",
    "data-slot": "input-group-control",
    role: "textbox",
  },
  handleKeyDown: (view, event) => {
    if (event.key !== "Enter" || event.isComposing) {
      return false;
    }
    event.preventDefault();
    view.dom.closest("form")?.requestSubmit();
    return true;
  },
  transformPastedText: (value, _plain, view) => {
    const { from, to } = view.state.selection;
    return truncateTemplateSubjectPaste(
      normalizePastedSubject(value),
      view.state.doc,
      from,
      to
    );
  },
} satisfies EditorProps;

interface TemplateSubjectEditorProps {
  readonly contentKey: string;
  readonly defaultValue: string;
  readonly onChange: (value: string) => void;
  readonly previewContext?: Omit<TemplateVariableContext, "now">;
}

const TemplateSubjectEditor = ({
  contentKey,
  defaultValue,
  onChange,
  previewContext,
}: TemplateSubjectEditorProps) => {
  const contentKeyRef = useRef(contentKey);
  const [editorContent, setEditorContent] = useState(() =>
    templateTextToVariableDocument(defaultValue)
  );

  const editor = useEditor({
    content: editorContent,
    editorProps: SUBJECT_EDITOR_PROPS,
    extensions: SUBJECT_EXTENSIONS,
    onUpdate: ({ editor: currentEditor }) => {
      onChange(variableDocumentToTemplateText(currentEditor.getJSON()));
    },
    shouldRerenderOnTransaction: false,
  });

  useLayoutEffect(() => {
    if (editor === null || contentKeyRef.current === contentKey) {
      return;
    }
    contentKeyRef.current = contentKey;
    const content = templateTextToVariableDocument(defaultValue);
    setEditorContent(content);
    editor.commands.setContent(content, {
      emitUpdate: false,
    });
    resetEditorHistory(editor);
  }, [contentKey, defaultValue, editor]);

  return (
    <>
      <EditorContent className="min-w-0 flex-1" editor={editor} />
      <InputGroupAddon align="inline-end" className="p-0">
        <TemplateVariablePicker
          disabled={editor === null}
          editor={editor}
          previewContext={previewContext}
        />
      </InputGroupAddon>
    </>
  );
};

export default TemplateSubjectEditor;
