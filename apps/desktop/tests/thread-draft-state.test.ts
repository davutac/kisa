import { describe, expect, it } from "vitest";

import {
  adoptSavedDraft,
  getThreadDraftStart,
} from "../src/renderer/src/components/mail/thread-draft-state";
import { createThreadMailDraft } from "../src/renderer/src/mail/mail-draft";

const reply = createThreadMailDraft({
  accountId: "person@example.com",
  action: "reply",
  messageId: "message-1",
  recipients: { bcc: [], cc: [], to: ["friend@example.com"] },
  threadId: "thread-1",
});
const newer = { ...reply, body: { html: "<p>Newer</p>", text: "Newer" } };
const other = { ...newer, id: "another-draft" };

describe(getThreadDraftStart, () => {
  // The saved draft could not be read, so whether one exists is unknown.
  // Creating one would replace it unseen; asking again is the only safe step.
  it("loads again, and never creates, when the saved draft could not be read", () => {
    expect(
      getThreadDraftStart({ action: "reply", draft: null, load: "failed" })
    ).toStrictEqual({ kind: "reload" });
  });

  it("waits while loading, then creates only when there is no draft", () => {
    expect(
      getThreadDraftStart({ action: "reply", draft: null, load: "loading" })
    ).toStrictEqual({ kind: "wait" });
    expect(
      getThreadDraftStart({ action: "reply", draft: null, load: "loaded" })
    ).toStrictEqual({ kind: "create" });
  });

  it("continues a draft it knows of, however it learned of it", () => {
    expect(
      getThreadDraftStart({ action: "reply", draft: reply, load: "failed" })
    ).toStrictEqual({ kind: "continue" });
    expect(
      getThreadDraftStart({ action: "forward", draft: reply, load: "loaded" })
    ).toStrictEqual({ draftAction: "reply", kind: "other-action" });
  });
});

describe(adoptSavedDraft, () => {
  // A collapsed draft must show what is stored, so Continue opens the
  // newest text rather than an older copy this window held.
  it("takes another window's newer copy of a collapsed draft", () => {
    expect(adoptSavedDraft(reply, newer, false)).toBe(newer);
    expect(adoptSavedDraft(null, newer, false)).toBe(newer);
  });

  it("never replaces the draft an open composer is editing", () => {
    expect(adoptSavedDraft(reply, newer, true)).toBe(reply);
  });

  it("keeps its draft when another one is saved", () => {
    expect(adoptSavedDraft(reply, other, false)).toBe(reply);
  });
});
