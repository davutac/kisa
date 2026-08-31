import { describe, expect, it, vi } from "vitest";

import { handleScheduledMailOutcome } from "../src/renderer/src/scheduled/scheduled-mail-outcome";
import type { ScheduledMailOutcomeActions } from "../src/renderer/src/scheduled/scheduled-mail-outcome";

const createActions = (): ScheduledMailOutcomeActions => ({
  navigate: vi.fn<ScheduledMailOutcomeActions["navigate"]>(),
  notify: vi.fn<ScheduledMailOutcomeActions["notify"]>(),
  requestAttentionOpen:
    vi.fn<ScheduledMailOutcomeActions["requestAttentionOpen"]>(),
  selectAccount: vi.fn<ScheduledMailOutcomeActions["selectAccount"]>(),
  selectInbox: vi.fn<ScheduledMailOutcomeActions["selectInbox"]>(),
  setSentMailbox: vi.fn<ScheduledMailOutcomeActions["setSentMailbox"]>(),
});

describe("scheduled mail outcome listener actions", () => {
  it("shows content-free feedback without navigating", () => {
    const actions = createActions();

    handleScheduledMailOutcome(
      {
        accountId: "person@example.com",
        draftId: "private-draft-id",
        intent: "feedback",
        kind: "sent",
      },
      actions
    );

    expect(actions.notify).toHaveBeenCalledWith(
      "success",
      "Scheduled email sent"
    );
    expect(actions.navigate).not.toHaveBeenCalled();
    expect(actions.requestAttentionOpen).not.toHaveBeenCalled();
  });

  it("opens Sent in the outcome account after a sent notification click", () => {
    const actions = createActions();

    handleScheduledMailOutcome(
      {
        accountId: "person@example.com",
        draftId: "draft-1",
        intent: "open",
        kind: "sent",
      },
      actions
    );

    expect(actions.selectInbox).toHaveBeenCalledWith("person@example.com");
    expect(actions.setSentMailbox).toHaveBeenCalledOnce();
    expect(actions.navigate).toHaveBeenCalledWith("/");
    expect(actions.requestAttentionOpen).not.toHaveBeenCalled();
  });

  it("opens and focuses the matching attention row after a notification click", () => {
    const actions = createActions();

    handleScheduledMailOutcome(
      {
        accountId: "person@example.com",
        draftId: "draft-1",
        intent: "open",
        kind: "attention",
      },
      actions
    );

    expect(actions.selectAccount).toHaveBeenCalledWith("person@example.com");
    expect(actions.requestAttentionOpen).toHaveBeenCalledWith({
      accountId: "person@example.com",
      draftId: "draft-1",
    });
    expect(actions.navigate).toHaveBeenCalledWith("/scheduled");
    expect(actions.selectInbox).not.toHaveBeenCalled();
  });
});
