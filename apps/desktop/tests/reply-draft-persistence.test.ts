import { describe, expect, it, vi } from "vitest";

import { createReplyDraftPersistence } from "../src/renderer/src/components/mail/reply-area/reply-draft-persistence";
import { createThreadMailDraft } from "../src/renderer/src/mail/mail-draft";
import type { MailApi } from "../src/renderer/src/platform/desktop";

const accountId = "person@example.com";
const threadId = "thread-1";

const draft = {
  ...createThreadMailDraft({
    accountId,
    action: "reply",
    messageId: "message-1",
    recipients: { bcc: [], cc: [], to: ["friend@example.com"] },
    threadId,
  }),
  body: { html: "<p>Half a reply</p>", text: "Half a reply" },
};

const createHarness = () => {
  const discardDraft = vi.fn<MailApi["discardDraft"]>(() =>
    Promise.resolve({ data: undefined, ok: true })
  );
  const saveDraft = vi.fn<MailApi["saveDraft"]>((saved) =>
    Promise.resolve({
      data: { ...saved, createdAt: 1, updatedAt: 2 },
      ok: true,
    })
  );
  const onError = vi.fn<(message: string) => void>();
  const persistence = createReplyDraftPersistence({
    accountId,
    api: { discardDraft, saveDraft },
    draftId: draft.id,
    onError,
  });
  return { discardDraft, onError, persistence, saveDraft };
};

const removal = (draftId: string) =>
  ({ accountId, draftId, kind: "remove", threadId }) as const;

describe(createReplyDraftPersistence, () => {
  it("keeps a written draft and drops an untouched one when the composer closes", async () => {
    const written = createHarness();
    const untouched = createHarness();

    await written.persistence.settle(draft, false);
    await untouched.persistence.settle(draft, true);

    expect(written.saveDraft).toHaveBeenCalledExactlyOnceWith(draft);
    expect(untouched.saveDraft).not.toHaveBeenCalled();
    expect(untouched.discardDraft).toHaveBeenCalledExactlyOnceWith({
      accountId,
      draftId: draft.id,
    });
  });

  it("writes nothing once this window has sent or discarded the draft", async () => {
    const harness = createHarness();

    harness.persistence.finalize();
    await harness.persistence.save(draft);
    await harness.persistence.settle(draft, false);

    expect(harness.saveDraft).not.toHaveBeenCalled();
    expect(harness.discardDraft).not.toHaveBeenCalled();
  });

  it("writes again after this window's own discard failed", async () => {
    const harness = createHarness();

    harness.persistence.finalize();
    harness.persistence.reopen();
    await harness.persistence.settle(draft, false);

    expect(harness.saveDraft).toHaveBeenCalledExactlyOnceWith(draft);
  });

  // Another window on the same conversation sent or discarded the draft. Its
  // removal closes this composer, and closing must not save the draft back.
  it("writes nothing once the draft was removed elsewhere", async () => {
    const harness = createHarness();

    harness.persistence.observe(removal(draft.id));
    // A discard of its own that failed must not bring the draft back either.
    harness.persistence.reopen();
    await harness.persistence.save(draft);
    await harness.persistence.settle(draft, false);

    expect(harness.saveDraft).not.toHaveBeenCalled();
    expect(harness.discardDraft).not.toHaveBeenCalled();
  });

  it("keeps writing when another draft is removed or this one is saved elsewhere", async () => {
    const harness = createHarness();

    harness.persistence.observe(removal("another-draft"));
    harness.persistence.observe({
      draft: { ...draft, createdAt: 1, updatedAt: 2 },
      kind: "upsert",
    });
    await harness.persistence.save(draft);

    expect(harness.saveDraft).toHaveBeenCalledExactlyOnceWith(draft);
  });

  it("reports a failed save without throwing", async () => {
    const harness = createHarness();
    harness.saveDraft
      .mockResolvedValueOnce({ error: "Could not save draft now", ok: false })
      .mockRejectedValueOnce(new Error("bridge closed"));

    await harness.persistence.save(draft);
    await harness.persistence.save(draft);

    expect(harness.onError.mock.calls).toStrictEqual([
      ["Could not save draft now"],
      ["Could not save draft"],
    ]);
  });
});
