import type { Editor } from "@tiptap/core";
import { EditorState, Selection } from "@tiptap/pm/state";

export const resetEditorHistory = (editor: Editor): void => {
  const { doc, plugins } = editor.state;
  editor.view.updateState(
    EditorState.create({
      doc,
      plugins,
      selection: Selection.atEnd(doc),
    })
  );
};
