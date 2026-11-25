import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import type {
  EditorChange,
  TextEditorAdapter,
} from "@ui-sdk/react/trigger-menu";

// ui-sdk reads a token or any other inline atom as U+FFFC.
const LEAF_TEXT = "\uFFFC";

// Block boundaries take a position each, so offsets stay ProseMirror positions.
const BOUNDARY_TEXT = "\n";

export interface TiptapTextAdapterOptions {
  readonly allows?: (textblock: ProseMirrorNode) => boolean;
}

const fragmentText = (fragment: Fragment): string => {
  let text = "";

  for (const node of fragment.content) {
    if (node.isText) {
      text += node.text ?? "";
    } else if (node.isLeaf) {
      text += LEAF_TEXT;
    } else {
      text += `${BOUNDARY_TEXT}${fragmentText(node.content)}${BOUNDARY_TEXT}`;
    }
  }

  return text;
};

const isProgrammatic = (transaction: Transaction, step: ReplaceStep) =>
  transaction.getMeta("preventUpdate") === true ||
  transaction.getMeta("addToHistory") === false ||
  (step.from === 0 && step.to === transaction.before.content.size);

const stepChanges = (transaction: Transaction): EditorChange[] =>
  transaction.steps.flatMap((step) => {
    if (!(step instanceof ReplaceStep)) {
      return [];
    }

    const { content, openEnd, openStart } = step.slice;
    const text = fragmentText(content);

    return [
      {
        inserted: text.slice(openStart, text.length - openEnd),
        range: { end: step.to, start: step.from },
        type: "input",
        user: !isProgrammatic(transaction, step),
      } satisfies EditorChange,
    ];
  });

export const createTiptapTextAdapter = (
  editor: Editor,
  { allows = () => true }: TiptapTextAdapterOptions = {}
): TextEditorAdapter => ({
  composing: () => editor.view.composing,
  get element() {
    return editor.isDestroyed ? undefined : editor.view.dom;
  },
  rectAt: (offset) => {
    try {
      const { bottom, left, top } = editor.view.coordsAtPos(offset);

      return { height: bottom - top, width: 0, x: left, y: top };
    } catch {
      return null;
    }
  },
  replace: (range, content) => {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ui-sdk's adapter contract hands over text, or a token read by its label.
    const text = typeof content === "string" ? content : content.label;
    const { view } = editor;

    const transaction = closeHistory(
      view.state.tr.insertText(text, range.start, range.end)
    );

    transaction.setSelection(
      TextSelection.create(transaction.doc, range.start + text.length)
    );
    view.dispatch(transaction.scrollIntoView());
    // Typing straight after the insertion starts its own undo step too.
    view.dispatch(closeHistory(view.state.tr));
  },
  selection: () => {
    if (editor.isDestroyed || !editor.view.hasFocus()) {
      return null;
    }

    const { from, to } = editor.state.selection;

    return { end: to, start: from };
  },
  subscribe: (listener) => {
    const handleTransaction = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (transaction.docChanged) {
        for (const change of stepChanges(transaction)) {
          listener(change);
        }
      } else if (transaction.selectionSet) {
        listener({ type: "selection" });
      }
    };

    const handleCompositionStart = () => listener({ type: "compositionstart" });
    const handleCompositionEnd = () => listener({ type: "compositionend" });
    const { dom } = editor.view;
    editor.on("transaction", handleTransaction);
    dom.addEventListener("compositionstart", handleCompositionStart);
    dom.addEventListener("compositionend", handleCompositionEnd);

    return () => {
      editor.off("transaction", handleTransaction);
      dom.removeEventListener("compositionstart", handleCompositionStart);
      dom.removeEventListener("compositionend", handleCompositionEnd);
    };
  },
  textBefore: (length) => {
    const { $head } = editor.state.selection;
    const { parent } = $head;

    if (!(parent.isTextblock && allows(parent))) {
      return null;
    }

    const end = $head.parentOffset;
    const start = Math.max(0, end - length);
    const text = parent.textBetween(start, end, undefined, LEAF_TEXT);

    // At a block's start, its opening position reads as a line break, so a
    // trigger there is at a boundary rather than after unseen text.
    return start > 0 || text.length === length
      ? { offset: $head.start() + start, text }
      : { offset: $head.start() - 1, text: `${BOUNDARY_TEXT}${text}` };
  },
});
