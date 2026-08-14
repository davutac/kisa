import { describe, expect, it } from "vitest";

import {
  appendPendingCleanDraftVersion,
  completePendingCleanDraftVersion,
  dismissCleanDraftVersion,
} from "../src/renderer/src/components/mail/clean-draft-history";
import type { CleanDraftVersion } from "../src/renderer/src/components/mail/clean-draft-history";
import { createNewMessageStore } from "../src/renderer/src/components/mail/new-message/new-message-store";

const appendReadyVersion = (
  history: readonly CleanDraftVersion[],
  original: { body: string; subject: string },
  cleaned: { body: string; subject: string }
): readonly CleanDraftVersion[] => {
  const pending = appendPendingCleanDraftVersion(history, original);
  const completed = completePendingCleanDraftVersion(
    pending.history,
    pending.version.id,
    cleaned
  );
  if (completed === undefined) {
    throw new Error("Pending clean was not completed");
  }
  return completed.history;
};

describe("clean draft history", () => {
  it("captures the original and first cleaned draft on the first clean", () => {
    const history = appendReadyVersion(
      [],
      { body: "<p>Original</p>", subject: "Original subject" },
      { body: "<p>Cleaned</p>", subject: "Cleaned subject" }
    );

    expect(history).toStrictEqual([
      {
        body: "<p>Original</p>",
        id: "original",
        label: "Original",
        status: "ready",
        subject: "Original subject",
      },
      {
        body: "<p>Cleaned</p>",
        id: expect.stringMatching(/^clean-/u),
        label: "#1 Clean",
        status: "ready",
        subject: "Cleaned subject",
      },
    ]);
  });

  it("appends numbered clean versions without replacing earlier versions", () => {
    const first = appendReadyVersion(
      [],
      { body: "original", subject: "original" },
      { body: "first", subject: "first" }
    );
    const second = appendReadyVersion(
      first,
      { body: "ignored", subject: "ignored" },
      { body: "second", subject: "second" }
    );

    expect(second.map(({ label }) => label)).toStrictEqual([
      "Original",
      "#1 Clean",
      "#2 Clean",
    ]);
    expect(second.at(-1)?.label).toBe("#2 Clean");
    expect(first).toHaveLength(2);
  });

  it("resets history and selection together at a draft boundary", () => {
    const store = createNewMessageStore("");
    const history = appendReadyVersion(
      [],
      { body: "original", subject: "original" },
      { body: "clean", subject: "clean" }
    );
    store.getState().setCleanHistory(history);
    store.getState().setSelectedCleanVersionId(history.at(1)?.id ?? null);

    store.getState().resetCleanHistory();

    expect(store.getState().cleanHistory).toStrictEqual([]);
    expect(store.getState().selectedCleanVersionId).toBeNull();
  });

  it("dismisses a clean and falls back to the preceding version", () => {
    const first = appendReadyVersion(
      [],
      { body: "original", subject: "original" },
      { body: "first", subject: "first" }
    );
    const history = appendReadyVersion(
      first,
      { body: "ignored", subject: "ignored" },
      { body: "second", subject: "second" }
    );

    const selectedId = history.at(-1)?.id ?? null;
    const dismissal = dismissCleanDraftVersion(
      history,
      selectedId ?? "",
      selectedId
    );

    expect(dismissal.history.map(({ label }) => label)).toStrictEqual([
      "Original",
      "#1 Clean",
    ]);
    expect(dismissal.selectedVersion?.label).toBe("#1 Clean");
  });

  it("does not dismiss the original version", () => {
    const history = appendReadyVersion(
      [],
      { body: "original", subject: "original" },
      { body: "first", subject: "first" }
    );

    const dismissal = dismissCleanDraftVersion(history, "original", "original");

    expect(dismissal.history).toBe(history);
    expect(dismissal.selectedVersion?.id).toBe("original");
  });

  it("adds a loading version and completes it in place", () => {
    const pending = appendPendingCleanDraftVersion([], {
      body: "original",
      subject: "original",
    });

    expect(pending.version.status).toBe("loading");
    expect(pending.history.map(({ label }) => label)).toStrictEqual([
      "Original",
      "#1 Clean",
    ]);

    const completed = completePendingCleanDraftVersion(
      pending.history,
      pending.version.id,
      { body: "clean", subject: "clean" }
    );

    expect(completed?.version).toStrictEqual({
      body: "clean",
      id: pending.version.id,
      label: "#1 Clean",
      status: "ready",
      subject: "clean",
    });
  });

  it("keeps clean numbers increasing after a dismissal", () => {
    const first = appendReadyVersion(
      [],
      { body: "original", subject: "original" },
      { body: "first", subject: "first" }
    );
    const second = appendReadyVersion(
      first,
      { body: "ignored", subject: "ignored" },
      { body: "second", subject: "second" }
    );
    const dismissed = dismissCleanDraftVersion(
      second,
      first.at(-1)?.id ?? "",
      second.at(-1)?.id ?? null
    );

    const pending = appendPendingCleanDraftVersion(dismissed.history, {
      body: "second",
      subject: "second",
    });

    expect(pending.version.label).toBe("#3 Clean");
  });

  it("tracks concurrent pending cleans independently", () => {
    const first = appendPendingCleanDraftVersion([], {
      body: "original",
      subject: "original",
    });
    const second = appendPendingCleanDraftVersion(first.history, {
      body: "original",
      subject: "original",
    });

    const completedFirst = completePendingCleanDraftVersion(
      second.history,
      first.version.id,
      { body: "first", subject: "first" }
    );
    const completedHistory = completedFirst?.history ?? second.history;

    expect(completedHistory.map(({ label }) => label)).toStrictEqual([
      "Original",
      "#1 Clean",
      "#2 Clean",
    ]);
    expect(
      completedHistory.find(({ id }) => id === first.version.id)?.status
    ).toBe("ready");
    expect(
      completedHistory.find(({ id }) => id === second.version.id)?.status
    ).toBe("loading");
  });

  it("does not reuse a dismissed pending request ID", () => {
    const dismissed = appendPendingCleanDraftVersion([], {
      body: "original",
      subject: "original",
    });
    const remaining = dismissCleanDraftVersion(
      dismissed.history,
      dismissed.version.id,
      "original"
    );
    const replacement = appendPendingCleanDraftVersion(remaining.history, {
      body: "updated",
      subject: "updated",
    });

    expect(replacement.version.id).not.toBe(dismissed.version.id);
    expect(
      completePendingCleanDraftVersion(
        replacement.history,
        dismissed.version.id,
        { body: "stale", subject: "stale" }
      )
    ).toBeUndefined();
  });

  it("skips pending versions when choosing a dismissal fallback", () => {
    const first = appendPendingCleanDraftVersion([], {
      body: "original",
      subject: "original",
    });
    const second = appendPendingCleanDraftVersion(first.history, {
      body: "newer",
      subject: "newer",
    });

    const dismissal = dismissCleanDraftVersion(
      second.history,
      second.version.id,
      second.version.id
    );

    expect(dismissal.selectedVersion?.id).toBe("original");
  });
});
