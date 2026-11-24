import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailApi } from "../src/renderer/src/platform/desktop";
import type { UndoOffer } from "../src/renderer/src/undo/undo-provider";

const fakes = vi.hoisted(() => ({
  bulkMutateThreads: vi.fn<MailApi["bulkMutateThreads"]>(),
  offers: [] as UndoOffer[],
  reportThreadSpam: vi.fn<MailApi["reportThreadSpam"]>(),
  setThreadLabel: vi.fn<MailApi["setThreadLabel"]>(),
}));

vi.mock(import("@/platform/desktop"), async (importOriginal) => {
  // Only what these actions call; anything else would throw.
  const api: Partial<MailApi> = {
    bulkMutateThreads: fakes.bulkMutateThreads,
    reportThreadSpam: fakes.reportThreadSpam,
    setThreadLabel: fakes.setThreadLabel,
  };
  return { ...(await importOriginal()), getMailApi: () => api as MailApi };
});

vi.mock(import("@/undo/undo-provider"), async (importOriginal) => ({
  ...(await importOriginal()),
  useOfferUndo: () => (offer: UndoOffer) => {
    fakes.offers.push(offer);
  },
}));

const { useThreadActions } =
  await import("../src/renderer/src/mail/use-thread-actions");

const THREAD = { accountId: "ana@example.com", threadId: "t1" };
const OTHER = { accountId: "ben@example.com", threadId: "t1" };

const renderActions = () => {
  fakes.setThreadLabel.mockResolvedValue({ data: undefined, ok: true });
  fakes.reportThreadSpam.mockResolvedValue({ data: undefined, ok: true });
  fakes.bulkMutateThreads.mockImplementation((request) =>
    Promise.resolve({
      data: { failed: [], succeeded: request.threads },
      ok: true,
    })
  );
  return renderHook(() => useThreadActions()).result.current;
};

/** Runs the latest Undo offer and returns what it sent to main. */
const undoLatest = async () => {
  const offer = fakes.offers.at(-1);
  await offer?.outcome;
  await offer?.undo();
  return fakes.bulkMutateThreads.mock.calls.at(-1)?.[0];
};

describe("thread actions as sent to main", () => {
  afterEach(() => {
    fakes.offers.length = 0;
    vi.clearAllMocks();
  });

  it("archives by taking INBOX off, and undoes by putting it back", async () => {
    const actions = renderActions();

    actions.archive(THREAD);
    const undone = await undoLatest();

    expect({
      sent: fakes.setThreadLabel.mock.calls,
      undone,
    }).toStrictEqual({
      sent: [[{ ...THREAD, applied: false, labelId: "INBOX" }]],
      undone: {
        operation: { applied: true, kind: "setLabel", labelId: "INBOX" },
        threads: [THREAD],
      },
    });
  });

  it("reports spam through its own method, and undoes into the Inbox", async () => {
    const actions = renderActions();

    actions.reportSpam(THREAD);
    const undone = await undoLatest();

    expect({
      sent: fakes.reportThreadSpam.mock.calls,
      undone,
    }).toStrictEqual({
      sent: [[THREAD]],
      undone: { operation: { kind: "moveToInbox" }, threads: [THREAD] },
    });
  });

  it("stars and moves to the Inbox without an Undo, since the same control reverses them", async () => {
    const actions = renderActions();

    actions.toggleStar({ ...THREAD, isStarred: false });
    actions.moveToInbox(THREAD);
    await Promise.resolve();

    expect({
      offers: fakes.offers.length,
      sent: fakes.setThreadLabel.mock.calls,
    }).toStrictEqual({
      offers: 0,
      sent: [
        [{ ...THREAD, applied: true, labelId: "STARRED" }],
        [{ ...THREAD, applied: true, labelId: "INBOX" }],
      ],
    });
  });

  it("sends a selection's Archive, Star and Report spam as one bulk operation each", async () => {
    const actions = renderActions();

    actions.bulkArchive([THREAD, OTHER]);
    actions.bulkSetStarred([THREAD, OTHER], false);
    actions.bulkReportSpam([THREAD, OTHER]);
    await Promise.resolve();

    expect(
      fakes.bulkMutateThreads.mock.calls.map(([request]) => request.operation)
    ).toStrictEqual([
      { applied: false, kind: "setLabel", labelId: "INBOX" },
      { applied: false, kind: "setLabel", labelId: "STARRED" },
      { kind: "moveToSpam" },
    ]);
  });
});
