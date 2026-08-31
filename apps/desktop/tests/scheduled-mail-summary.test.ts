import { describe, expect, it } from "vitest";

import type { JoinedScheduledMessage } from "../src/main/mail/scheduled-mail-database";
import { toScheduledMailSummary } from "../src/main/mail/scheduled-mail-summary";

const row = {
  draft: {
    accountEmail: "person@example.com",
    attachments: [
      {
        authorizationVersion: 1 as const,
        birthtimeMs: 1,
        device: "private-device",
        filename: "image.png",
        id: "attachment-1",
        inode: "private-inode",
        mediaType: "image/png",
        mtimeMs: 1,
        path: "/private/image.png",
        size: 100,
      },
    ],
    bcc: [],
    bodyHtml: "<p>Preview</p>",
    bodyText: "Preview",
    cc: [],
    createdAt: 1,
    id: "draft-1",
    kind: "new" as const,
    messageId: null,
    signatureAccountEmail: null,
    signatureHtml: null,
    signatureText: null,
    subject: "Hello",
    threadId: null,
    to: ["friend@example.com"],
    updatedAt: 1,
  },
  schedule: {
    attemptCount: 0,
    attemptId: null,
    attentionReason: null,
    createdAt: 1,
    draftId: "draft-1",
    lastAttemptAt: null,
    nextAttemptAt: 2000,
    notificationClaimId: null,
    notificationClaimedAt: null,
    notifiedAt: null,
    rateLimitStartedAt: null,
    revision: 1,
    rfcMessageId: "<scheduled@example.invalid>",
    scheduledAt: 2000,
    status: "scheduled" as const,
    updatedAt: 1,
  },
} satisfies JoinedScheduledMessage;

describe(toScheduledMailSummary, () => {
  it("exposes only attachment metadata needed by the list pill", () => {
    const summary = toScheduledMailSummary(row);

    expect(summary.attachments).toStrictEqual([
      { filename: "image.png", mediaType: "image/png" },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(
      /private-device|private-inode|private\/image|attachment-1/u
    );
  });
});
