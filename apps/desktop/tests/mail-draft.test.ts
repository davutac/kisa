import { describe, expect, it } from "@effect/vitest";

import type { EmailRecipients } from "../src/renderer/src/components/mail/email-recipient-fields";
import {
  createNewMailDraft,
  createThreadMailDraft,
  getDraftBodyPreview,
  getDraftResumeFocusTarget,
  getNewMailStashCommandAction,
  isNewMailDraftEmpty,
  isThreadMailDraftEmpty,
} from "../src/renderer/src/mail/mail-draft";
import type { MailDraftInput } from "../src/shared/ipc/mail";

const accountId = "person@example.com";

const newDraft = (patch: Partial<MailDraftInput> = {}): MailDraftInput => ({
  ...createNewMailDraft(accountId),
  id: "draft-1",
  ...patch,
});

describe("mail draft lifecycle", () => {
  it("formats a draft body as a single-line preview", () => {
    expect(getDraftBodyPreview("  First line\n\nSecond\tline  ")).toBe(
      "First line Second line"
    );
    expect(getDraftBodyPreview(" \n\t ")).toBe("");
  });

  it("focuses the first incomplete field when resuming a stash", () => {
    expect(getDraftResumeFocusTarget(newDraft())).toBe("to");
    expect(
      getDraftResumeFocusTarget(newDraft({ to: ["friend@example.com"] }))
    ).toBe("subject");
    expect(
      getDraftResumeFocusTarget(
        newDraft({ subject: "Hello", to: ["friend@example.com"] })
      )
    ).toBe("message");
  });

  it("treats a truly blank new email as empty", () => {
    expect(isNewMailDraftEmpty(newDraft())).toBeTruthy();
    expect(
      isNewMailDraftEmpty(
        newDraft({ body: { html: "<p> </p>", text: "  \n" } })
      )
    ).toBeTruthy();
  });

  it("allows a new email draft to remain unassigned", () => {
    expect(createNewMailDraft()).not.toHaveProperty("accountId");
  });

  it("opens stashes from a blank form and stashes a dirty form", () => {
    expect(getNewMailStashCommandAction(newDraft(), true)).toBe("open-picker");
    expect(getNewMailStashCommandAction(newDraft(), false)).toBe("none");
    expect(getNewMailStashCommandAction(createNewMailDraft(), false)).toBe(
      "none"
    );
    expect(
      getNewMailStashCommandAction(newDraft({ subject: "Hello" }), true)
    ).toBe("stash");
    expect(
      getNewMailStashCommandAction(
        { ...createNewMailDraft(), subject: "Hello" },
        false
      )
    ).toBe("stash");
  });

  it.each([
    ["recipient", { to: ["friend@example.com"] }],
    ["Cc recipient", { cc: ["copy@example.com"] }],
    ["Bcc recipient", { bcc: ["hidden@example.com"] }],
    ["subject", { subject: "Hello" }],
    ["body", { body: { html: "<p>Hello</p>", text: "Hello" } }],
    [
      "attachment",
      {
        attachments: [
          {
            filename: "notes.txt",
            id: "attachment-1",
            mediaType: "text/plain",
            referenceId: "reference-1",
            size: 5,
          },
        ],
      },
    ],
  ] satisfies readonly [string, Partial<MailDraftInput>][])(
    "keeps a new email with a %s",
    (_label, patch) => {
      expect(isNewMailDraftEmpty(newDraft(patch))).toBeFalsy();
    }
  );

  it("does not count reply recipients supplied by the app as user content", () => {
    const recipients: EmailRecipients = {
      bcc: [],
      cc: ["team@example.com"],
      to: ["sender@example.com"],
    };
    const draft = createThreadMailDraft({
      accountId,
      action: "reply-all",
      messageId: "message-1",
      recipients,
      threadId: "thread-1",
    });

    expect(isThreadMailDraftEmpty(draft, recipients)).toBeTruthy();
    expect(
      isThreadMailDraftEmpty(
        { ...draft, to: [...draft.to, "another@example.com"] },
        recipients
      )
    ).toBeFalsy();
    expect(
      isThreadMailDraftEmpty(
        { ...draft, body: { html: "<p>Thanks</p>", text: "Thanks" } },
        recipients
      )
    ).toBeFalsy();
  });

  it("creates account-scoped thread drafts with their action target", () => {
    const draft = createThreadMailDraft({
      accountId,
      action: "forward",
      messageId: "message-1",
      recipients: { bcc: [], cc: [], to: [] },
      threadId: "thread-1",
    });

    expect(draft).toMatchObject({
      accountId,
      kind: "forward",
      messageId: "message-1",
      threadId: "thread-1",
    });
  });
});
