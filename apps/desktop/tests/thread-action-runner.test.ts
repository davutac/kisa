import { describe, expect, it } from "@effect/vitest";

import type { PendingThreadChange } from "../src/renderer/src/mail/pending-thread-changes";
import {
  fromBulkReply,
  fromThreadReply,
  runThreadAction,
  toThreadMutationOperation,
} from "../src/renderer/src/mail/thread-action-runner";
import type {
  ThreadActionOutcome,
  ThreadActionPlan,
  ThreadActionPorts,
} from "../src/renderer/src/mail/thread-action-runner";
import type { UndoOffer } from "../src/renderer/src/undo/undo-provider";
import type {
  MailBulkThreadMutationRequest,
  MailThreadRequest,
} from "../src/shared/ipc/mail";

const first = { accountId: "a@example.com", threadId: "1" };
const second = { accountId: "a@example.com", threadId: "2" };
// Another account's conversation with the same id.
const elsewhere = { accountId: "b@example.com", threadId: "1" };

interface ShownChange {
  readonly change: PendingThreadChange;
  settled: boolean;
  readonly threads: readonly MailThreadRequest[];
}

const makePorts = () => {
  const shown: ShownChange[] = [];
  const offers: UndoOffer[] = [];
  const errors: { description?: string; id?: unknown; message: string }[] = [];
  const successes: string[] = [];
  const inverses: MailBulkThreadMutationRequest[] = [];
  const ports: ThreadActionPorts = {
    bulkMutateThreads: (request) => {
      inverses.push(request);
      return Promise.resolve({
        data: { failed: [], succeeded: request.threads },
        ok: true,
      });
    },
    notifyError: (message, options) => {
      errors.push({ message, ...options });
    },
    notifySuccess: (message) => {
      successes.push(message);
      return `toast-${successes.length}`;
    },
    offerUndo: (offer) => {
      offers.push(offer);
    },
    showPending: (threads, change) => {
      const entry: ShownChange = { change, settled: false, threads };
      shown.push(entry);
      return () => {
        entry.settled = true;
      };
    },
  };

  return { errors, inverses, offers, ports, shown, successes };
};

/** A server answer the test gives when it chooses. */
const answerLater = () => Promise.withResolvers<ThreadActionOutcome>();

const done = (
  succeeded: readonly MailThreadRequest[],
  failedCount = 0
): ThreadActionOutcome => ({ failedCount, kind: "done", succeeded });

const trashPlan = (
  threads: readonly MailThreadRequest[],
  send: () => Promise<ThreadActionOutcome>,
  overrides: Partial<ThreadActionPlan> = {}
): ThreadActionPlan => ({
  change: { kind: "trash" },
  failureMessage: "Some conversations were not moved to trash",
  message: "Moved conversations to trash",
  send,
  threads,
  undo: {
    change: { kind: "moveToInbox" },
    failureMessage: "Could not restore the conversations",
    undoneMessage: "Restored conversations to the inbox",
  },
  ...overrides,
});

describe(runThreadAction, () => {
  it("shows the change, its feedback and the way out before the server answers", async () => {
    const { offers, ports, shown } = makePorts();
    const answer = answerLater();
    let left = false;

    const outcome = runThreadAction(
      ports,
      trashPlan([first], () => answer.promise, {
        onLeave: () => {
          left = true;
        },
      })
    );

    expect(shown).toStrictEqual([
      { change: { kind: "trash" }, settled: false, threads: [first] },
    ]);
    expect(left).toBeTruthy();
    expect(offers.map((offer) => offer.message)).toStrictEqual([
      "Moved conversations to trash",
    ]);

    answer.resolve(done([first]));
    await outcome;

    expect(shown[0]?.settled).toBeTruthy();
    await expect(offers[0]?.outcome).resolves.toStrictEqual({
      kind: "confirmed",
    });
  });

  it("puts back a refused change and withdraws its Undo", async () => {
    const { inverses, offers, ports, shown } = makePorts();

    await runThreadAction(
      ports,
      trashPlan([first], () =>
        Promise.resolve({ kind: "failed", message: "Mail server is offline" })
      )
    );

    expect(shown[0]?.settled).toBeTruthy();
    await expect(offers[0]?.outcome).resolves.toStrictEqual({
      kind: "failed",
      message: "Mail server is offline",
    });

    await offers[0]?.undo();

    expect(inverses).toStrictEqual([]);
  });

  it("turns its own toast into the error when an action without Undo fails", async () => {
    const { errors, ports, successes } = makePorts();

    await runThreadAction(ports, {
      change: { isUnread: false, kind: "setReadState" },
      failureMessage: "Could not update email",
      message: "Marked as read",
      send: () =>
        Promise.resolve({ kind: "failed", message: "Mail server is offline" }),
      threads: [first],
    });

    expect(successes).toStrictEqual(["Marked as read"]);
    expect(errors).toStrictEqual([
      {
        description: undefined,
        id: "toast-1",
        message: "Mail server is offline",
      },
    ]);
  });

  it("reports a partial failure and undoes only what changed", async () => {
    const { inverses, offers, ports } = makePorts();

    await runThreadAction(
      ports,
      trashPlan([first, second], () => Promise.resolve(done([first], 1)))
    );

    await expect(offers[0]?.outcome).resolves.toStrictEqual({
      description: "1 of 2 conversations could not be updated.",
      kind: "partial",
      message: "Some conversations were not moved to trash",
    });

    await offers[0]?.undo();

    expect(inverses).toStrictEqual([
      { operation: { kind: "moveToInbox" }, threads: [first] },
    ]);
  });

  it("lets Undo run before the answer, then reverses only what changed", async () => {
    const { inverses, offers, ports, shown } = makePorts();
    const answer = answerLater();

    void runThreadAction(
      ports,
      trashPlan([first, elsewhere], () => answer.promise)
    );
    const undone = offers[0]?.undo();

    // Both show as restored at once; nothing is sent until the trash answers.
    expect(
      shown.map(({ change, threads }) => [change.kind, threads])
    ).toStrictEqual([
      ["trash", [first, elsewhere]],
      ["moveToInbox", [first, elsewhere]],
    ]);
    expect(inverses).toStrictEqual([]);

    answer.resolve(done([elsewhere], 1));
    await undone;

    expect(inverses).toStrictEqual([
      { operation: { kind: "moveToInbox" }, threads: [elsewhere] },
    ]);
    expect(shown.every((entry) => entry.settled)).toBeTruthy();
  });

  it("sends no inverse for a refused change, even when Undo came first", async () => {
    const { inverses, offers, ports } = makePorts();
    const answer = answerLater();

    // Undoing a refused "not spam" must not move the conversation's other
    // copies into Spam.
    void runThreadAction(ports, {
      change: { kind: "moveToInbox" },
      failureMessage: "Could not mark email as not spam",
      message: "Moved conversation to the inbox",
      send: () => answer.promise,
      threads: [first],
      undo: {
        change: { kind: "moveToSpam" },
        failureMessage: "Could not move the conversation back to spam",
        undoneMessage: "Moved conversation back to spam",
      },
    });
    const undone = offers[0]?.undo();

    answer.resolve({ kind: "failed", message: "Mail server is offline" });
    await undone;

    expect(inverses).toStrictEqual([]);
  });

  it("leaves a conversation's own window only once the server agrees", async () => {
    const { ports } = makePorts();
    const leaves: string[] = [];
    const refused = answerLater();
    const accepted = answerLater();

    const refusedOutcome = runThreadAction(
      ports,
      trashPlan([first], () => refused.promise, {
        leaveAfterConfirmation: true,
        onLeave: () => leaves.push("refused"),
      })
    );
    const acceptedOutcome = runThreadAction(
      ports,
      trashPlan([second], () => accepted.promise, {
        leaveAfterConfirmation: true,
        onLeave: () => leaves.push("accepted"),
      })
    );

    expect(leaves).toStrictEqual([]);

    refused.resolve({ kind: "failed", message: "Mail server is offline" });
    accepted.resolve(done([second]));
    await Promise.all([refusedOutcome, acceptedOutcome]);

    expect(leaves).toStrictEqual(["accepted"]);
  });

  it("keeps each of two quick toggles shown until its own answer", async () => {
    const { ports, shown } = makePorts();
    const firstAnswer = answerLater();
    const secondAnswer = answerLater();
    const toggle = (
      isUnread: boolean,
      send: () => Promise<ThreadActionOutcome>
    ) =>
      runThreadAction(ports, {
        change: { isUnread, kind: "setReadState" },
        failureMessage: "Could not update email",
        message: isUnread ? "Marked as unread" : "Marked as read",
        send,
        threads: [first],
      });

    const read = toggle(false, () => firstAnswer.promise);
    void toggle(true, () => secondAnswer.promise);
    firstAnswer.resolve(done([first]));
    await read;

    expect(shown.map((entry) => entry.settled)).toStrictEqual([true, false]);
  });
});

describe(fromBulkReply, () => {
  it("counts a selection where nothing changed as a failure", async () => {
    await expect(
      fromBulkReply(
        [first, second],
        () =>
          Promise.resolve({
            data: { failed: [first, second], succeeded: [] },
            ok: true,
          }),
        "Some conversations were not updated"
      )
    ).resolves.toStrictEqual({
      description: "2 of 2 conversations could not be updated.",
      kind: "failed",
      message: "Some conversations were not updated",
    });
  });
});

describe(fromThreadReply, () => {
  it("treats a rejected bridge call as a failed action", async () => {
    await expect(
      fromThreadReply(
        first,
        () => Promise.reject(new Error("The window went away")),
        "Could not update email"
      )
    ).resolves.toStrictEqual({
      kind: "failed",
      message: "The window went away",
    });
  });
});

describe(toThreadMutationOperation, () => {
  it("keeps the label's name in the renderer", () => {
    expect(
      toThreadMutationOperation({
        applied: false,
        kind: "setLabel",
        labelId: "u:Work",
        labelName: "Work",
      })
    ).toStrictEqual({ applied: false, kind: "setLabel", labelId: "u:Work" });
  });
});
