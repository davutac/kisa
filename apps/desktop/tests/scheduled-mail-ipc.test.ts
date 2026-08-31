import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MAX_GMAIL_SUBJECT_LENGTH } from "../src/shared/gmail-subject";
import { MAX_GOOGLE_ACCOUNTS } from "../src/shared/ipc/auth";
import {
  MAX_SCHEDULED_MAIL_PREVIEW_LENGTH,
  SCHEDULED_MAIL_PAGE_SIZE,
  ScheduledMailAttentionCount,
  ScheduledMailChanged,
  ScheduledMailFinishEditResult,
  ScheduledMailFinishEditRequest,
  ScheduledMailPage,
  ScheduledMailPageRequest,
  ScheduledMailOutcome,
  ScheduledMailOutcomeReadiness,
  ScheduledMailSummary,
} from "../src/shared/ipc/scheduled-mail";

const draft = {
  accountId: "person@example.com",
  attachments: [],
  bcc: [],
  body: { html: "<p>Hello</p>", text: "Hello" },
  cc: [],
  id: "draft-1",
  kind: "new" as const,
  subject: "Hello",
  to: ["friend@example.com"],
};

const summary = {
  accountId: "person@example.com",
  attachments: [{ filename: "image.png", mediaType: "image/png" }],
  deliveryState: "scheduled" as const,
  draftId: "draft-1",
  preview: "x".repeat(MAX_SCHEDULED_MAIL_PREVIEW_LENGTH),
  recipients: ["friend@example.com"],
  revision: 1,
  scheduledAt: 1,
  subject: "Hello",
};

describe("scheduled mail IPC", () => {
  it("reports scoped scheduled-mail presence without loading summaries", () => {
    const result = { count: 0, hasScheduledMail: true };

    expect(
      Schema.decodeSync(ScheduledMailAttentionCount)(result)
    ).toStrictEqual(result);
    expect(() =>
      Schema.decodeUnknownSync(ScheduledMailAttentionCount)({ count: 0 })
    ).toThrow(/./u);
  });

  it("bounds account scopes and uses a fixed page size with an opaque cursor", () => {
    expect(SCHEDULED_MAIL_PAGE_SIZE).toBe(50);
    expect(
      Schema.decodeSync(ScheduledMailPageRequest)({
        accountIds: ["person@example.com"],
        cursor: "opaque-cursor",
      })
    ).toStrictEqual({
      accountIds: ["person@example.com"],
      cursor: "opaque-cursor",
    });
    expect(() =>
      Schema.decodeSync(ScheduledMailPageRequest)({
        accountIds: Array.from(
          { length: MAX_GOOGLE_ACCOUNTS + 1 },
          (_, index) => `person-${index}@example.com`
        ),
      })
    ).toThrow(/./u);
    expect(() =>
      Schema.encodeUnknownSync(ScheduledMailPage)({
        items: Array.from(
          { length: SCHEDULED_MAIL_PAGE_SIZE + 1 },
          () => summary
        ),
      })
    ).toThrow(/./u);
  });

  it("bounds and sanitizes list summaries", () => {
    expect(Schema.decodeSync(ScheduledMailSummary)(summary)).toStrictEqual(
      summary
    );
    expect(() =>
      Schema.decodeSync(ScheduledMailSummary)({
        ...summary,
        preview: `${summary.preview}x`,
      })
    ).toThrow(/./u);
    expect(() =>
      Schema.decodeSync(ScheduledMailSummary)({
        ...summary,
        subject: "x".repeat(MAX_GMAIL_SUBJECT_LENGTH + 1),
      })
    ).toThrow(/./u);
    expect(
      Schema.encodeUnknownSync(ScheduledMailSummary)({
        ...summary,
        attachments: [
          {
            filename: "image.png",
            mediaType: "image/png",
            path: "/private/file.txt",
            referenceId: "private-capability",
          },
        ],
        body: "private body",
      })
    ).toStrictEqual(summary);
  });

  it("keeps renderer events account-qualified and content-free", () => {
    const changed = {
      accountId: "person@example.com",
      draftId: "draft-1",
      kind: "upsert" as const,
    };
    const outcome = {
      accountId: "person@example.com",
      draftId: "draft-1",
      intent: "open" as const,
      kind: "attention" as const,
    };

    expect(
      Schema.encodeUnknownSync(ScheduledMailChanged)({
        ...changed,
        body: "private body",
        rawGmailError: "private error",
      })
    ).toStrictEqual(changed);
    expect(
      Schema.encodeUnknownSync(ScheduledMailOutcome)({
        ...outcome,
        credentials: "private credentials",
        path: "/private/file.txt",
      })
    ).toStrictEqual(outcome);
  });

  it("accepts only boolean renderer-outcome readiness", () => {
    expect(Schema.decodeSync(ScheduledMailOutcomeReadiness)(true)).toBeTruthy();
    expect(() =>
      Schema.decodeUnknownSync(ScheduledMailOutcomeReadiness)("ready")
    ).toThrow(/./u);
  });

  it("requires edited content for delivery-changing edit actions", () => {
    const request = {
      accountId: "person@example.com",
      action: {
        allowPossibleDuplicate: false,
        draft,
        kind: "send-now" as const,
      },
      draftId: "draft-1",
    };

    expect(
      Schema.decodeSync(ScheduledMailFinishEditRequest)(request)
    ).toStrictEqual(request);
    expect(() =>
      Schema.decodeUnknownSync(ScheduledMailFinishEditRequest)({
        ...request,
        action: { allowPossibleDuplicate: false, kind: "send-now" },
      })
    ).toThrow(/./u);
  });

  it("returns an authoritative live session for nonterminal edit updates", () => {
    const session = {
      draft: { ...draft, createdAt: 1, subject: "Normalized", updatedAt: 2 },
      item: { ...summary, revision: 2 },
    };

    expect(
      Schema.decodeSync(ScheduledMailFinishEditResult)({
        kind: "saved",
        session,
      })
    ).toStrictEqual({ kind: "saved", session });
    expect(
      Schema.decodeSync(ScheduledMailFinishEditResult)({ kind: "finished" })
    ).toStrictEqual({ kind: "finished" });
    expect(() =>
      Schema.decodeUnknownSync(ScheduledMailFinishEditResult)({ kind: "saved" })
    ).toThrow(/./u);
  });
});
