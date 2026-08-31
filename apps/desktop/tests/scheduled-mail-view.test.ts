import { describe, expect, it } from "vitest";

import {
  getScheduledMailAttentionCopy,
  getScheduledMailKey,
  getScheduledRecipientSummary,
  orderScheduledMailItems,
  shouldCloseScheduledMailEditor,
} from "../src/renderer/src/scheduled/scheduled-mail-view";
import type { ScheduledMailSummary } from "../src/shared/ipc/scheduled-mail";

const scheduledMail = (
  patch: Partial<ScheduledMailSummary> = {}
): ScheduledMailSummary => ({
  accountId: "person@example.com",
  attachments: [],
  deliveryState: "scheduled",
  draftId: "draft-1",
  preview: "Preview",
  recipients: ["friend@example.com"],
  revision: 1,
  scheduledAt: 100,
  subject: "Hello",
  ...patch,
});

describe("scheduled mail list presentation", () => {
  it("keeps account identity in row keys", () => {
    expect(
      getScheduledMailKey(
        scheduledMail({ accountId: "first@example.com", draftId: "same" })
      )
    ).not.toBe(
      getScheduledMailKey(
        scheduledMail({ accountId: "second@example.com", draftId: "same" })
      )
    );
  });

  it("defensively orders attention items before scheduled delivery times", () => {
    const laterAttention = scheduledMail({
      attentionReason: "outcome-unknown",
      deliveryState: "attention",
      draftId: "attention",
      scheduledAt: 300,
    });
    const earlierScheduled = scheduledMail({
      draftId: "scheduled",
      scheduledAt: 100,
    });

    expect(
      orderScheduledMailItems([earlierScheduled, laterAttention]).map(
        ({ draftId }) => draftId
      )
    ).toStrictEqual(["attention", "scheduled"]);
  });

  it("uses clear attention and recipient summaries", () => {
    expect(getScheduledMailAttentionCopy("outcome-unknown")).toBe(
      "Delivery could not be confirmed; check Sent"
    );
    expect(getScheduledMailAttentionCopy()).toBe(
      "Review this email before sending"
    );
    expect(getScheduledRecipientSummary([])).toBe("No recipient");
    expect(
      getScheduledRecipientSummary([
        "first@example.com",
        "second@example.com",
        "third@example.com",
      ])
    ).toBe("first@example.com +2");
  });

  it("closes only the editor whose scheduled item was removed", () => {
    const session = {
      draft: {
        accountId: "person@example.com",
        attachments: [],
        bcc: [],
        body: { html: "<p>Hello</p>", text: "Hello" },
        cc: [],
        createdAt: 1,
        id: "draft-1",
        kind: "new" as const,
        subject: "Hello",
        to: ["friend@example.com"],
        updatedAt: 1,
      },
      item: scheduledMail(),
    };

    expect(
      shouldCloseScheduledMailEditor(
        {
          accountId: "person@example.com",
          draftId: "draft-1",
          kind: "remove",
        },
        session
      )
    ).toBeTruthy();
    expect(
      shouldCloseScheduledMailEditor(
        {
          accountId: "person@example.com",
          draftId: "draft-1",
          kind: "upsert",
        },
        session
      )
    ).toBeFalsy();
    expect(
      shouldCloseScheduledMailEditor(
        {
          accountId: "other@example.com",
          draftId: "draft-1",
          kind: "remove",
        },
        session
      )
    ).toBeFalsy();
  });
});
