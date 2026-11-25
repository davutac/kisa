import type { MailMessageAction } from "@/mail/reply-recipients";
import type { MailDraftInput } from "@/shared/ipc/mail";

export type ThreadDraftLoad = "failed" | "loaded" | "loading";

export const getThreadDraftAction = (
  draft: MailDraftInput
): MailMessageAction => (draft.kind === "new" ? "reply" : draft.kind);

export type ThreadDraftStart =
  | { readonly kind: "continue" }
  | { readonly kind: "create" }
  | {
      readonly draftAction: MailMessageAction;
      readonly kind: "other-action";
    }
  | { readonly kind: "reload" }
  | { readonly kind: "wait" };

/**
 * What Reply, Reply all or Forward does in a conversation. A conversation
 * keeps one draft, and creating one replaces any draft already stored, so a
 * new one is created only once a load has said there is none.
 */
export const getThreadDraftStart = ({
  action,
  draft,
  load,
}: {
  readonly action: MailMessageAction;
  readonly draft: MailDraftInput | null;
  readonly load: ThreadDraftLoad;
}): ThreadDraftStart => {
  if (draft !== null) {
    const draftAction = getThreadDraftAction(draft);
    return draftAction === action
      ? { kind: "continue" }
      : { draftAction, kind: "other-action" };
  }
  if (load === "loading") {
    return { kind: "wait" };
  }
  return load === "failed" ? { kind: "reload" } : { kind: "create" };
};

/**
 * The draft a conversation holds once a draft for it is saved anywhere. A
 * collapsed draft takes the stored copy, so Continue opens the newest text;
 * the draft an open composer is editing is never replaced under it.
 */
export const adoptSavedDraft = (
  current: MailDraftInput | null,
  saved: MailDraftInput,
  isComposerOpen: boolean
): MailDraftInput | null => {
  if (current === null) {
    return saved;
  }
  return current.id === saved.id && !isComposerOpen ? saved : current;
};
