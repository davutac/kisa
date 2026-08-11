import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";

import { MAX_GMAIL_SUBJECT_LENGTH } from "@/shared/gmail-subject";

import { variableDocumentToTemplateText } from "./template-variable";

const getSourceLength = (document: ProseMirrorNode): number =>
  variableDocumentToTemplateText(document.toJSON()).length;

export const templateSubjectIsWithinLimit = (
  document: ProseMirrorNode
): boolean => getSourceLength(document) <= MAX_GMAIL_SUBJECT_LENGTH;

export const TemplateSubjectLimit = Extension.create({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        filterTransaction: (transaction) =>
          !transaction.docChanged ||
          templateSubjectIsWithinLimit(transaction.doc),
      }),
    ];
  },
  name: "templateSubjectLimit",
});

export const truncateTemplateSubjectPaste = (
  value: string,
  document: ProseMirrorNode,
  from: number,
  to: number
): string => {
  const selectedLength = getSourceLength(document.cut(from, to));
  const availableLength = Math.max(
    0,
    MAX_GMAIL_SUBJECT_LENGTH - getSourceLength(document) + selectedLength
  );
  return value.slice(0, availableLength);
};
