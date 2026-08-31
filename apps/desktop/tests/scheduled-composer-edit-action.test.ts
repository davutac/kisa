import { describe, expect, it, vi } from "vitest";

import { runScheduledComposerEditAction } from "../src/renderer/src/components/mail/new-message/scheduled-composer-edit-action";
import type {
  ScheduledMailEditSession,
  ScheduledMailFinishEditReply,
  ScheduledMailFinishEditRequest,
} from "../src/shared/ipc/scheduled-mail";

const draft = {
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
};

const session: ScheduledMailEditSession = {
  draft,
  item: {
    accountId: "person@example.com",
    attachments: [],
    deliveryState: "scheduled",
    draftId: "draft-1",
    preview: "Hello",
    recipients: ["friend@example.com"],
    revision: 1,
    scheduledAt: 2000,
    subject: "Hello",
  },
};

const createHarness = () => ({
  finishEdit:
    vi.fn<
      (
        request: ScheduledMailFinishEditRequest
      ) => Promise<ScheduledMailFinishEditReply>
    >(),
  onError: vi.fn<(message: string) => void>(),
  onFinished: vi.fn<() => void>(),
  onSaved: vi.fn<(nextSession: ScheduledMailEditSession) => void>(),
  setPending: vi.fn<(pending: boolean) => void>(),
});

describe(runScheduledComposerEditAction, () => {
  it("rebases an in-place save", async () => {
    const harness = createHarness();
    const savedSession = {
      ...session,
      draft: { ...draft, subject: "Normalized", updatedAt: 2 },
      item: { ...session.item, revision: 2, subject: "Normalized" },
    };
    harness.finishEdit.mockResolvedValue({
      data: { kind: "saved", session: savedSession },
      ok: true,
    });

    await expect(
      runScheduledComposerEditAction({
        action: { draft: { ...draft, subject: " Normalized " }, kind: "save" },
        errorMessage: "Could not save",
        finishEdit: harness.finishEdit,
        onError: harness.onError,
        onFinished: harness.onFinished,
        onSaved: harness.onSaved,
        session,
        setPending: harness.setPending,
      })
    ).resolves.toBeTruthy();

    expect(harness.onSaved).toHaveBeenCalledExactlyOnceWith(savedSession);
    expect(harness.onFinished).not.toHaveBeenCalled();
    expect(harness.setPending.mock.calls).toStrictEqual([[true], [false]]);
  });

  it("keeps a failed save retryable and dirty", async () => {
    const harness = createHarness();
    harness.finishEdit.mockResolvedValue({
      error: "Revision changed",
      ok: false,
    });

    const run = () =>
      runScheduledComposerEditAction({
        action: { draft, kind: "save" },
        errorMessage: "Could not save",
        finishEdit: harness.finishEdit,
        onError: harness.onError,
        onFinished: harness.onFinished,
        onSaved: harness.onSaved,
        session,
        setPending: harness.setPending,
      });

    await expect(run()).resolves.toBeFalsy();
    harness.finishEdit.mockResolvedValue({
      data: {
        kind: "saved",
        session: { ...session, item: { ...session.item, revision: 2 } },
      },
      ok: true,
    });
    await expect(run()).resolves.toBeTruthy();

    expect(harness.onError).toHaveBeenCalledExactlyOnceWith("Revision changed");
    expect(harness.onSaved).toHaveBeenCalledOnce();
  });

  it("refreshes a rescheduled session without finishing the editor", async () => {
    const harness = createHarness();
    const rescheduledSession = {
      ...session,
      item: { ...session.item, revision: 2, scheduledAt: 3000 },
    };
    harness.finishEdit.mockResolvedValue({
      data: { kind: "saved", session: rescheduledSession },
      ok: true,
    });

    await expect(
      runScheduledComposerEditAction({
        action: {
          allowPossibleDuplicate: false,
          draft,
          kind: "reschedule",
          scheduledAt: 3000,
        },
        errorMessage: "Could not reschedule",
        finishEdit: harness.finishEdit,
        onError: harness.onError,
        onFinished: harness.onFinished,
        onSaved: harness.onSaved,
        session,
        setPending: harness.setPending,
      })
    ).resolves.toBeTruthy();

    expect(harness.onSaved).toHaveBeenCalledExactlyOnceWith(rescheduledSession);
    expect(harness.onFinished).not.toHaveBeenCalled();
  });

  it("finishes the editor only after a terminal action succeeds", async () => {
    const harness = createHarness();
    harness.finishEdit.mockResolvedValue({
      data: { kind: "finished" },
      ok: true,
    });

    await expect(
      runScheduledComposerEditAction({
        action: { kind: "discard" },
        errorMessage: "Could not discard",
        finishEdit: harness.finishEdit,
        onError: harness.onError,
        onFinished: harness.onFinished,
        onSaved: harness.onSaved,
        session: { ...session, item: { ...session.item, revision: 2 } },
        setPending: harness.setPending,
      })
    ).resolves.toBeTruthy();

    expect(harness.finishEdit).toHaveBeenCalledWith({
      accountId: session.item.accountId,
      action: { kind: "discard" },
      draftId: session.item.draftId,
    });
    expect(harness.onFinished).toHaveBeenCalledOnce();
  });
});
