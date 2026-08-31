import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { normalizeValidScheduledDeliveryDraft } from "../src/main/mail/scheduled-mail-draft-validation";
import { MAX_GMAIL_SUBJECT_LENGTH } from "../src/shared/gmail-subject";

const key = {
  accountId: "one@example.com",
  draftId: "draft-1",
};

const makeDraft = (subject: string) => ({
  accountId: key.accountId,
  attachments: [],
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  id: key.draftId,
  kind: "new" as const,
  subject,
  to: ["to@example.com"],
});

describe(normalizeValidScheduledDeliveryDraft, () => {
  it("accepts the immediate-send subject limit and rejects one character more", async () => {
    const maximumSubject = "x".repeat(MAX_GMAIL_SUBJECT_LENGTH);

    const accepted = await Effect.runPromise(
      normalizeValidScheduledDeliveryDraft(key, makeDraft(maximumSubject))
    );
    expect(accepted.subject).toBe(maximumSubject);
    await expect(
      Effect.runPromise(
        normalizeValidScheduledDeliveryDraft(
          key,
          makeDraft(`${maximumSubject}x`)
        )
      )
    ).rejects.toThrow("The subject is too long");
  });

  it("validates and persists the trimmed subject", async () => {
    const normalized = await Effect.runPromise(
      normalizeValidScheduledDeliveryDraft(key, makeDraft("  Hello  "))
    );
    expect(normalized.subject).toBe("Hello");
  });
});
