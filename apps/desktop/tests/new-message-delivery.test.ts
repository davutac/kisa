import { describe, expect, it, vi } from "vitest";

import {
  describeComposerDelivery,
  getComposerDeliveryLabel,
  shouldConfirmScheduledEditorClose,
  submitNewMessageDelivery,
} from "../src/renderer/src/components/mail/new-message/new-message-delivery";
import { formatScheduledAt } from "../src/renderer/src/scheduled/schedule-time";

describe("new message delivery choice", () => {
  it("selects and clears a send time without starting delivery", () => {
    const schedule = vi.fn<(scheduledAt: number) => Promise<boolean>>();
    const selected = 123;

    expect(schedule).not.toHaveBeenCalled();
    expect(getComposerDeliveryLabel(false, selected)).toBe("Schedule");
    expect(getComposerDeliveryLabel(false)).toBe("Send");
  });

  it("uses the same local selection step while editing a scheduled email", () => {
    expect(getComposerDeliveryLabel(true)).toBe("Send now");
    expect(getComposerDeliveryLabel(true, 123)).toBe("Reschedule");
  });

  it("confirms close for an unchanged draft with a pending reschedule", () => {
    expect(shouldConfirmScheduledEditorClose(false, true)).toBeTruthy();
    expect(shouldConfirmScheduledEditorClose(false, false)).toBeFalsy();
  });

  it("schedules the selected instant exactly once from the primary action", async () => {
    const schedule = vi
      .fn<(scheduledAt: number) => Promise<boolean>>()
      .mockResolvedValue(true);
    const send = vi.fn<() => Promise<void>>().mockResolvedValue();
    await submitNewMessageDelivery(123, { schedule, send });

    expect(schedule).toHaveBeenCalledExactlyOnceWith(123);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps immediate delivery on the Send action", async () => {
    const schedule = vi.fn<(scheduledAt: number) => Promise<boolean>>();
    const send = vi.fn<() => Promise<void>>().mockResolvedValue();

    await submitNewMessageDelivery(undefined, { schedule, send });

    expect(send).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
  });
});

describe(describeComposerDelivery, () => {
  const target = {
    recipients: {
      bcc: ["cy@example.com"],
      cc: [],
      to: ["ana@example.com", "bo@example.com"],
    },
    subject: "  Lunch?  ",
  };
  const at = new Date(2030, 4, 20, 13).getTime();

  it("says what the composer's primary action will do, to whom", () => {
    expect([
      describeComposerDelivery(false, undefined, target),
      describeComposerDelivery(false, at, target),
      describeComposerDelivery(true, undefined, target),
      describeComposerDelivery(true, at, target),
    ]).toStrictEqual([
      "Sends “Lunch?” to ana@example.com, bo@example.com, cy@example.com",
      `Schedules “Lunch?” to ana@example.com, bo@example.com, cy@example.com for ${formatScheduledAt(at)}`,
      "Sends “Lunch?” to ana@example.com, bo@example.com, cy@example.com now, before its scheduled time",
      `Reschedules “Lunch?” to ana@example.com, bo@example.com, cy@example.com for ${formatScheduledAt(at)}`,
    ]);
  });

  it("names an email without a subject or recipients plainly", () => {
    expect(
      describeComposerDelivery(false, undefined, {
        recipients: { bcc: [], cc: [], to: [] },
        subject: " ",
      })
    ).toBe("Sends this email");
  });
});
