import { describe, expect, it, vi } from "vitest";

import {
  restoreComposeDraft,
  restoreReplyDraft,
  takeComposeDraft,
  takeReplyDraft,
  toUndoSendOffer,
} from "../src/renderer/src/mail/undo-send";
import type { HeldSend } from "../src/renderer/src/mail/undo-send";
import type { MailDraftInput } from "../src/shared/ipc/mail";

const heldSend = () => ({
  cancel: vi.fn<HeldSend["cancel"]>(),
  delayMs: 10_000,
  keptIn: "It is in Stash.",
  restore: vi.fn<() => void>(),
  send: vi.fn<HeldSend["send"]>(),
});

describe("sending as an Undo offer", () => {
  it("lasts as long as main holds the message, then says how it went", async () => {
    const sent = heldSend();
    sent.send.mockResolvedValue({
      data: { kind: "sent", refusedRecipients: [] },
      ok: true,
    });
    const refused = heldSend();
    refused.send.mockResolvedValue({
      data: { kind: "sent", refusedRecipients: ["ben@example.com"] },
      ok: true,
    });

    const offer = toUndoSendOffer(sent);

    expect({
      duration: offer.durationMs,
      refused: await toUndoSendOffer(refused).outcome,
      sent: await offer.outcome,
    }).toStrictEqual({
      duration: 10_000,
      refused: {
        kind: "done",
        message: "Message sent, but the server refused ben@example.com",
        tone: "warning",
      },
      sent: { kind: "done", message: "Message sent", tone: "success" },
    });
  });

  it("says a failed message was not sent, why, and where its draft is, until dismissed", async () => {
    const failed = heldSend();
    failed.send.mockResolvedValue({ error: "Mailbox full", ok: false });

    const outcome = await toUndoSendOffer(failed).outcome;
    if (outcome.kind === "failed") {
      outcome.action?.onAction();
    }

    expect({
      opened: failed.restore.mock.calls.length,
      outcome: { ...outcome, action: undefined },
      withOpen: outcome.kind === "failed" ? outcome.action?.label : undefined,
    }).toStrictEqual({
      opened: 1,
      outcome: {
        action: undefined,
        description: "Mailbox full. It is in Stash.",
        kind: "failed",
        message: "Message not sent",
        stays: true,
      },
      withOpen: "Open",
    });
  });

  it("readies a reply's return before Undo asks, and calls it off when too late", async () => {
    const order: string[] = [];
    const tooLate = {
      ...heldSend(),
      expectRestore: () => {
        order.push("expect");
        return () => {
          order.push("call off");
        };
      },
      restore: undefined,
    };
    tooLate.send.mockResolvedValue({
      data: { kind: "sent", refusedRecipients: [] },
      ok: true,
    });
    tooLate.cancel.mockImplementation(() => {
      order.push("cancel");
      return Promise.resolve({ data: "too-late", ok: true });
    });

    await expect(toUndoSendOffer(tooLate).undo()).rejects.toThrow("Too late");
    expect(order).toStrictEqual(["expect", "cancel", "call off"]);
  });

  it("puts the message back once main has taken it back", async () => {
    const held = heldSend();
    held.send.mockResolvedValue({ data: { kind: "canceled" }, ok: true });
    held.cancel.mockResolvedValue({ data: "canceled", ok: true });
    const offer = toUndoSendOffer(held);

    await offer.undo();

    expect({
      outcome: await offer.outcome,
      restored: held.restore.mock.calls.length,
    }).toStrictEqual({ outcome: { kind: "confirmed" }, restored: 1 });
  });

  it("says when Undo comes too late, and leaves the message going", async () => {
    const held = heldSend();
    held.send.mockResolvedValue({
      data: { kind: "sent", refusedRecipients: [] },
      ok: true,
    });
    held.cancel.mockResolvedValue({ data: "too-late", ok: true });

    await expect(toUndoSendOffer(held).undo()).rejects.toThrow(
      "Too late to undo: the message is on its way"
    );
    expect(held.restore).not.toHaveBeenCalled();
  });
});

describe("drafts Undo took back", () => {
  it("are handed over once each", () => {
    const draft = { id: "new-1" } as MailDraftInput;
    restoreComposeDraft(draft);
    restoreReplyDraft("reply-1");

    expect({
      compose: [takeComposeDraft(), takeComposeDraft()],
      reply: [takeReplyDraft("reply-1"), takeReplyDraft("reply-1")],
    }).toStrictEqual({
      compose: [draft, undefined],
      reply: [true, false],
    });
  });
});
