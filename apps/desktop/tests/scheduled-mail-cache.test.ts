import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScheduledMailApi } from "../src/renderer/src/platform/desktop";
import {
  clearScheduledMailSnapshots,
  getScheduledMailScopeKey,
  getScheduledMailSnapshot,
  invalidateScheduledMailSnapshotsForAccount,
  setScheduledMailSnapshot,
} from "../src/renderer/src/scheduled/scheduled-mail-cache";
import { useScheduledMailPage } from "../src/renderer/src/scheduled/use-scheduled-mail-page";
import type { ScheduledMailSummary } from "../src/shared/ipc/scheduled-mail";

vi.mock(import("../src/renderer/src/platform/desktop"), () => ({
  getScheduledMailApi: vi.fn<() => ScheduledMailApi | undefined>(),
}));

const item: ScheduledMailSummary = {
  accountId: "one@example.com",
  attachments: [],
  deliveryState: "scheduled",
  draftId: "draft-1",
  preview: "Preview",
  recipients: ["friend@example.com"],
  revision: 1,
  scheduledAt: 100,
  subject: "Subject",
};

describe("scheduled mail snapshots", () => {
  beforeEach(() => {
    clearScheduledMailSnapshots();
  });

  it("restores a loaded page for the same account scope", () => {
    const scopeKey = getScheduledMailScopeKey(["one@example.com"]);
    const snapshot = {
      accountIds: ["one@example.com"],
      items: [item],
      nextCursor: "next-page",
      scopeKey,
    };

    setScheduledMailSnapshot(snapshot);

    expect(getScheduledMailSnapshot(scopeKey)).toStrictEqual(snapshot);
  });

  it("paints a restored page without returning to initial loading", () => {
    const accountIds = ["one@example.com"];
    const scopeKey = getScheduledMailScopeKey(accountIds);
    setScheduledMailSnapshot({ accountIds, items: [item], scopeKey });

    const Probe = () => {
      const page = useScheduledMailPage(accountIds);
      return createElement(
        "output",
        null,
        `${page.isInitialLoading ? "loading" : "settled"}:${page.items[0]?.draftId ?? "empty"}`
      );
    };

    expect(renderToStaticMarkup(createElement(Probe))).toContain(
      "settled:draft-1"
    );
  });

  it("treats account order as the same combined scope", () => {
    expect(
      getScheduledMailScopeKey(["two@example.com", "one@example.com"])
    ).toBe(getScheduledMailScopeKey(["one@example.com", "two@example.com"]));
  });

  it("invalidates every cached scope containing a changed account", () => {
    const oneScopeKey = getScheduledMailScopeKey(["one@example.com"]);
    const otherScopeKey = getScheduledMailScopeKey(["other@example.com"]);
    const combinedScopeKey = getScheduledMailScopeKey([
      "one@example.com",
      "other@example.com",
    ]);

    setScheduledMailSnapshot({
      accountIds: ["one@example.com"],
      items: [item],
      scopeKey: oneScopeKey,
    });
    setScheduledMailSnapshot({
      accountIds: ["other@example.com"],
      items: [],
      scopeKey: otherScopeKey,
    });
    setScheduledMailSnapshot({
      accountIds: ["one@example.com", "other@example.com"],
      items: [item],
      scopeKey: combinedScopeKey,
    });

    invalidateScheduledMailSnapshotsForAccount("one@example.com");

    expect(getScheduledMailSnapshot(oneScopeKey)).toBeUndefined();
    expect(getScheduledMailSnapshot(combinedScopeKey)).toBeUndefined();
    expect(getScheduledMailSnapshot(otherScopeKey)).toBeDefined();
  });
});
