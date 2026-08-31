import { describe, expect, it, vi } from "vitest";

import {
  getComposerDeliveryLabel,
  shouldConfirmScheduledEditorClose,
  submitNewMessageDelivery,
} from "../src/renderer/src/components/mail/new-message/new-message-delivery";

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
