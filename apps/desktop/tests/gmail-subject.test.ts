import { getSchema } from "@tiptap/core";
import { StarterKit } from "@tiptap/starter-kit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { createNewMessageStore } from "../src/renderer/src/components/mail/new-message/new-message-store";
import {
  templateSubjectIsWithinLimit,
  truncateTemplateSubjectPaste,
} from "../src/renderer/src/templates/template-subject-limit";
import {
  TemplateVariable,
  templateTextToVariableDocument,
} from "../src/renderer/src/templates/template-variable";
import {
  MAX_GMAIL_SUBJECT_LENGTH,
  truncateGmailSubject,
} from "../src/shared/gmail-subject";
import {
  GmailMessageSendRequest,
  MailDraftInput,
} from "../src/shared/ipc/mail";

const schema = getSchema([StarterKit, TemplateVariable]);

const subjectDocument = (subject: string) =>
  schema.nodeFromJSON(templateTextToVariableDocument(subject));

const sendRequest = (subject: string) => ({
  accountId: "person@example.com",
  attachments: [],
  bcc: [],
  body: { html: "", text: "" },
  cc: [],
  subject,
  to: ["friend@example.com"],
});

describe("Gmail subject limit", () => {
  it("truncates new-message subjects, including programmatic updates", () => {
    const oversized = "a".repeat(MAX_GMAIL_SUBJECT_LENGTH + 1);
    const store = createNewMessageStore("person@example.com");

    store.getState().setSubject(oversized);

    expect(store.getState().subject).toBe(truncateGmailSubject(oversized));
    expect(store.getState().subject).toHaveLength(MAX_GMAIL_SUBJECT_LENGTH);
  });

  it("rejects oversized subjects at the send boundary", () => {
    expect(() =>
      Schema.decodeSync(GmailMessageSendRequest)(
        sendRequest("a".repeat(MAX_GMAIL_SUBJECT_LENGTH))
      )
    ).not.toThrow();
    expect(() =>
      Schema.decodeSync(GmailMessageSendRequest)(
        sendRequest("a".repeat(MAX_GMAIL_SUBJECT_LENGTH + 1))
      )
    ).toThrow(
      `Expected a value with a length of at most ${MAX_GMAIL_SUBJECT_LENGTH}`
    );
  });

  it("accepts only opaque attachment capabilities at the send boundary", () => {
    expect(() =>
      Schema.decodeSync(GmailMessageSendRequest)({
        ...sendRequest("Subject"),
        attachments: [{ capability: "main-issued-capability" }],
      })
    ).not.toThrow();
    expect(() =>
      Schema.decodeUnknownSync(GmailMessageSendRequest)({
        ...sendRequest("Subject"),
        attachments: [
          {
            filename: "secrets.txt",
            mediaType: "text/plain",
            path: "/renderer-controlled/secrets.txt",
          },
        ],
      })
    ).toThrow("capability");
  });

  it("keeps stored drafts tolerant for backward compatibility", () => {
    expect(() =>
      Schema.decodeSync(MailDraftInput)({
        ...sendRequest("a".repeat(MAX_GMAIL_SUBJECT_LENGTH + 1)),
        id: "draft-1",
        kind: "new",
      })
    ).not.toThrow();
  });

  it("counts template-variable source tokens toward the limit", () => {
    const variable = "{{account.email}}";

    expect(
      templateSubjectIsWithinLimit(
        subjectDocument(
          `${"a".repeat(MAX_GMAIL_SUBJECT_LENGTH - variable.length)}${variable}`
        )
      )
    ).toBeTruthy();
    expect(
      templateSubjectIsWithinLimit(
        subjectDocument(
          `${"a".repeat(MAX_GMAIL_SUBJECT_LENGTH - variable.length + 1)}${variable}`
        )
      )
    ).toBeFalsy();
  });

  it("truncates pasted template subjects to the remaining space", () => {
    const document = subjectDocument("a".repeat(MAX_GMAIL_SUBJECT_LENGTH - 2));

    expect(truncateTemplateSubjectPaste("bcdef", document, 1, 1)).toBe("bc");
  });

  it("allows pasted text to replace the selected subject text", () => {
    const document = subjectDocument("a".repeat(MAX_GMAIL_SUBJECT_LENGTH));

    expect(truncateTemplateSubjectPaste("bcdef", document, 1, 3)).toBe("bc");
  });
});
