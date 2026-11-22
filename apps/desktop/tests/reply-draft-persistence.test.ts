import { describe, expect, it, vi } from "vitest";

import { createReplyDraftPersistence } from "../src/renderer/src/components/mail/reply-area/reply-draft-persistence";
import { createThreadMailDraft } from "../src/renderer/src/mail/mail-draft";
import type { MailApi } from "../src/renderer/src/platform/desktop";
import type { MailDraftInput } from "../src/shared/ipc/mail";

const accountId = "person@example.com";
const threadId = "thread-1";

/** The draft as this composer opened it. */
const opened = {
  ...createThreadMailDraft({
    accountId,
    action: "reply",
    messageId: "message-1",
    recipients: { bcc: [], cc: [], to: ["friend@example.com"] },
    threadId,
  }),
  body: { html: "<p>Half a reply</p>", text: "Half a reply" },
};

const withBody = (text: string): MailDraftInput => ({
  ...opened,
  body: { html: `<p>${text}</p>`, text },
});

const EMPTY = withBody("");
const EDITED = withBody("Half a reply, finished here");

/** The same draft as another window holds it: its own attachment references. */
const elsewhere = (draft: MailDraftInput, referenceId = "other-window") => ({
  draft: {
    ...draft,
    attachments: draft.attachments.map((attachment) => ({
      ...attachment,
      referenceId,
    })),
    createdAt: 1,
    updatedAt: 2,
  },
  kind: "upsert" as const,
});

const createHarness = (initial: MailDraftInput = opened) => {
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
    initial,
    onError,
  });
  return { discardDraft, onError, persistence, saveDraft };
};

const removal = (draftId: string) =>
  ({ accountId, draftId, kind: "remove", threadId }) as const;

describe(createReplyDraftPersistence, () => {
  // Opening a draft is not an edit. A window holding an older copy must not
  // write it back over a newer one just by opening or closing.
  it("writes nothing for a composer the user has not changed", async () => {
    const harness = createHarness();

    await harness.persistence.save(opened);
    await harness.persistence.settle(opened, false);

    expect(harness.saveDraft).not.toHaveBeenCalled();
    expect(harness.discardDraft).not.toHaveBeenCalled();
  });

  it("saves each change once, and nothing more when the composer closes on it", async () => {
    const harness = createHarness();

    await harness.persistence.save(EDITED);
    await harness.persistence.save(EDITED);
    await harness.persistence.settle(EDITED, false);

    expect(harness.saveDraft).toHaveBeenCalledExactlyOnceWith(EDITED);
  });

  it("saves a change back to how the draft opened", async () => {
    const harness = createHarness();

    await harness.persistence.save(EDITED);
    await harness.persistence.save(opened);

    expect(harness.saveDraft.mock.calls).toStrictEqual([[EDITED], [opened]]);
  });

  it("drops an empty draft when the composer closes", async () => {
    const untouched = createHarness(EMPTY);
    const emptied = createHarness();

    await untouched.persistence.settle(EMPTY, true);
    await emptied.persistence.settle(EMPTY, true);

    expect(untouched.discardDraft).toHaveBeenCalledExactlyOnceWith({
      accountId,
      draftId: opened.id,
    });
    expect(emptied.discardDraft).toHaveBeenCalledOnce();
    expect(emptied.saveDraft).not.toHaveBeenCalled();
  });

  // Another window on the conversation wrote the draft. This composer still
  // shows the older copy; closing it must neither write that back nor, being
  // empty here, delete what the other window wrote.
  it("leaves a copy another window wrote alone while this one is unchanged", async () => {
    const harness = createHarness(EMPTY);

    harness.persistence.observe(elsewhere(EDITED));
    await harness.persistence.save(EMPTY);
    await harness.persistence.settle(EMPTY, true);

    expect(harness.saveDraft).not.toHaveBeenCalled();
    expect(harness.discardDraft).not.toHaveBeenCalled();
  });

  it("knows its own saves when they come back, whatever their attachment references", async () => {
    const harness = createHarness();

    await harness.persistence.save(EDITED);
    harness.persistence.observe(elsewhere(EDITED, "this-window-echo"));
    await harness.persistence.settle(EMPTY, true);

    expect(harness.discardDraft).toHaveBeenCalledOnce();
  });

  it("writes nothing once this window has sent or discarded the draft", async () => {
    const harness = createHarness();

    harness.persistence.finalize();
    await harness.persistence.save(EDITED);
    await harness.persistence.settle(EDITED, false);

    expect(harness.saveDraft).not.toHaveBeenCalled();
    expect(harness.discardDraft).not.toHaveBeenCalled();
  });

  it("writes again after this window's own discard failed", async () => {
    const harness = createHarness();

    harness.persistence.finalize();
    harness.persistence.reopen();
    await harness.persistence.settle(EDITED, false);

    expect(harness.saveDraft).toHaveBeenCalledExactlyOnceWith(EDITED);
  });

  // Another window on the same conversation sent or discarded the draft. Its
  // removal closes this composer, and closing must not save the draft back.
  it("writes nothing once the draft was removed elsewhere", async () => {
    const harness = createHarness();

    harness.persistence.observe(removal(opened.id));
    // A discard of its own that failed must not bring the draft back either.
    harness.persistence.reopen();
    await harness.persistence.save(EDITED);
    await harness.persistence.settle(EDITED, false);

    expect(harness.saveDraft).not.toHaveBeenCalled();
    expect(harness.discardDraft).not.toHaveBeenCalled();
  });

  it("keeps writing when another draft is removed or saved", async () => {
    const harness = createHarness();

    harness.persistence.observe(removal("another-draft"));
    harness.persistence.observe(elsewhere({ ...EDITED, id: "another-draft" }));
    await harness.persistence.save(EDITED);

    expect(harness.saveDraft).toHaveBeenCalledExactlyOnceWith(EDITED);
  });

  it("reports a failed save without throwing, and tries the same change again", async () => {
    const harness = createHarness();
    harness.saveDraft
      .mockResolvedValueOnce({ error: "Could not save draft now", ok: false })
      .mockRejectedValueOnce(new Error("bridge closed"));

    await harness.persistence.save(EDITED);
    await harness.persistence.save(EDITED);

    expect(harness.onError.mock.calls).toStrictEqual([
      ["Could not save draft now"],
      ["Could not save draft"],
    ]);
  });
});
