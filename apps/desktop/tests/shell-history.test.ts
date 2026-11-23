import { describe, expect, it } from "vitest";

import {
  beginShellHistoryStep,
  createShellHistory,
  findShellHistoryStep,
  isShellPlaceAvailable,
  planShellPlaceStep,
  recordShellPlace,
  SHELL_HISTORY_LIMIT,
  settleShellHistoryStep,
  toShellPlace,
} from "../src/renderer/src/components/shell/shell-history";
import type {
  ShellHistory,
  ShellPlace,
} from "../src/renderer/src/components/shell/shell-history";

const inbox = (accountId: string | null): ShellPlace => ({
  accountId,
  kind: "mailbox",
  mailbox: "inbox",
});
const sent = (accountId: string | null): ShellPlace => ({
  accountId,
  kind: "mailbox",
  mailbox: "sent",
});
const label = (accountId: string | null, name: string): ShellPlace => ({
  accountId,
  kind: "mailbox",
  mailbox: { label: name },
});
const scheduled = (accountId: string | null): ShellPlace => ({
  accountId,
  kind: "scheduled",
});
const templates: ShellPlace = { kind: "workspace", path: "/templates" };
const everyPlace = (): boolean => true;
const isConnected = (place: ShellPlace): boolean =>
  place.kind === "workspace" || place.accountId !== "gone@example.com";

const visit = (...places: readonly ShellPlace[]): ShellHistory => {
  const [first, ...rest] = places;

  if (first === undefined) {
    throw new Error("visit needs a place");
  }

  let history = createShellHistory(first);

  for (const place of rest) {
    history = recordShellPlace(history, place);
  }

  return history;
};

/** Takes a step and returns the history with the target it is heading to. */
const takeStep = (
  history: ShellHistory,
  direction: -1 | 1,
  current: ShellPlace
) => {
  const index = findShellHistoryStep(history, direction, current, everyPlace);

  if (index === undefined) {
    throw new Error("expected a step");
  }

  const stepped = beginShellHistoryStep(history, index);
  const target = stepped.entries[index];

  if (target === undefined) {
    throw new Error("expected a target");
  }

  return { history: stepped, target };
};

describe("shell places", () => {
  it("ignores the scope left under Templates", () => {
    expect(
      toShellPlace({
        currentPath: "/templates",
        mailbox: "spam",
        selectedAccountId: "a@example.com",
      })
    ).toStrictEqual(templates);
    expect(
      toShellPlace({
        currentPath: "/scheduled",
        mailbox: "spam",
        selectedAccountId: "a@example.com",
      })
    ).toStrictEqual(scheduled("a@example.com"));
  });
});

describe("shell history", () => {
  it("records new places and keeps one entry per visit", () => {
    const history = visit(inbox(null), inbox(null), sent(null), templates);

    expect(history.entries).toStrictEqual([inbox(null), sent(null), templates]);
    expect(history.index).toBe(2);
    expect(recordShellPlace(history, templates)).toBe(history);
  });

  it("drops the places ahead once a new place is visited", () => {
    const visited = visit(inbox(null), sent(null), templates);
    const back = takeStep(visited, -1, templates);
    const arrived = recordShellPlace(back.history, back.target);
    const branched = recordShellPlace(arrived, scheduled(null));

    expect(branched.entries).toStrictEqual([
      inbox(null),
      sent(null),
      scheduled(null),
    ]);
    expect(
      findShellHistoryStep(branched, 1, scheduled(null), everyPlace)
    ).toBeUndefined();
  });

  it("keeps Forward across a step that changes scope before the route", () => {
    const visited = visit(sent("y@example.com"), scheduled("x@example.com"));
    const back = takeStep(visited, -1, scheduled("x@example.com"));
    // The store switches scope at once, so Scheduled briefly shows account y.
    const midway = recordShellPlace(back.history, scheduled("y@example.com"));
    const arrived = recordShellPlace(midway, sent("y@example.com"));

    expect(midway.entries).toStrictEqual(visited.entries);
    expect(arrived.pending).toBeNull();
    expect(
      findShellHistoryStep(arrived, 1, sent("y@example.com"), everyPlace)
    ).toBe(1);
  });

  it("resumes recording once a step that never arrived settles", () => {
    const visited = visit(inbox(null), templates);
    const back = takeStep(visited, -1, templates);
    const ignored = recordShellPlace(back.history, sent(null));
    const settled = settleShellHistoryStep(ignored, back.target);

    expect(ignored).toBe(back.history);
    expect(recordShellPlace(settled, sent(null)).entries).toStrictEqual([
      inbox(null),
      sent(null),
    ]);
  });

  it("leaves a newer step alone when an older one settles", () => {
    const visited = visit(inbox(null), sent(null), templates);
    const first = takeStep(visited, -1, templates);
    const second = takeStep(first.history, -1, templates);

    expect(settleShellHistoryStep(second.history, first.target)).toBe(
      second.history
    );
  });

  it("skips disconnected accounts and the place already on screen", () => {
    const history = visit(
      inbox(null),
      inbox("gone@example.com"),
      templates,
      inbox(null)
    );

    expect(findShellHistoryStep(history, -1, inbox(null), isConnected)).toBe(2);
    expect(findShellHistoryStep(history, -1, templates, isConnected)).toBe(0);
    expect(
      findShellHistoryStep(
        { ...history, index: 2 },
        -1,
        templates,
        (place) => isConnected(place) && place.kind !== "mailbox"
      )
    ).toBeUndefined();
  });

  it("keeps only the most recent places", () => {
    const places = Array.from({ length: SHELL_HISTORY_LIMIT + 5 }, (_, index) =>
      inbox(`account${index}@example.com`)
    );
    const history = visit(...places);

    expect(history.entries).toHaveLength(SHELL_HISTORY_LIMIT);
    expect(history.entries[0]).toStrictEqual(inbox("account5@example.com"));
    expect(history.index).toBe(SHELL_HISTORY_LIMIT - 1);
  });
});

describe("shell history steps", () => {
  const view = {
    currentPath: "/templates",
    mailbox: "sent",
    selectedAccountId: "a@example.com",
  } as const;

  it("returns to the mailbox under Templates without touching its scope", () => {
    expect(planShellPlaceStep(view, sent("a@example.com"))).toStrictEqual({
      path: "/",
      scope: { kind: "none" },
    });
    expect(planShellPlaceStep(view, scheduled("a@example.com"))).toStrictEqual({
      path: "/scheduled",
      scope: { kind: "none" },
    });
  });

  it("changes the scope only when the place needs another one", () => {
    expect(planShellPlaceStep(view, inbox("a@example.com"))).toStrictEqual({
      path: "/",
      scope: { accountId: "a@example.com", kind: "mailbox", mailbox: "inbox" },
    });
    expect(planShellPlaceStep(view, scheduled(null))).toStrictEqual({
      path: "/scheduled",
      scope: { accountId: null, kind: "account" },
    });
  });

  it("skips Scheduled once nothing is scheduled and disconnected accounts", () => {
    const availability = {
      accountIds: ["a@example.com"],
      hasScheduledMail: false,
      isLabelMissing: () => false,
    };

    expect(isShellPlaceAvailable(scheduled(null), availability)).toBeFalsy();
    expect(
      isShellPlaceAvailable(inbox("b@example.com"), availability)
    ).toBeFalsy();
    expect(isShellPlaceAvailable(inbox(null), availability)).toBeTruthy();
    expect(
      isShellPlaceAvailable(scheduled("a@example.com"), {
        ...availability,
        hasScheduledMail: true,
      })
    ).toBeTruthy();
  });
});

describe("label places in history", () => {
  it("records a label as its own place, apart from a mailbox named like it", () => {
    const history = visit(
      sent(null),
      label(null, "Sent"),
      label(null, "sent"),
      label("a@example.com", "Sent")
    );

    expect(history.entries).toStrictEqual([
      sent(null),
      label(null, "Sent"),
      label("a@example.com", "Sent"),
    ]);
  });

  it("opens a label from another place and keeps one already shown", () => {
    const view = {
      currentPath: "/",
      mailbox: { label: "Work" },
      selectedAccountId: null,
    } as const;

    expect(planShellPlaceStep(view, label(null, "work"))).toStrictEqual({
      path: "/",
      scope: { kind: "none" },
    });
    expect(planShellPlaceStep(view, label(null, "Travel"))).toStrictEqual({
      path: "/",
      scope: { accountId: null, kind: "mailbox", mailbox: { label: "Travel" } },
    });
  });

  it("skips a label its scope no longer has", () => {
    const checked: (readonly string[])[] = [];
    const availability = {
      accountIds: ["a@example.com", "b@example.com"],
      hasScheduledMail: false,
      isLabelMissing: (name: string, accountIds: readonly string[]) => {
        checked.push(accountIds);
        return name === "Gone";
      },
    };

    expect(
      isShellPlaceAvailable(label(null, "Gone"), availability)
    ).toBeFalsy();
    expect(
      isShellPlaceAvailable(label("b@example.com", "Work"), availability)
    ).toBeTruthy();
    expect(checked).toStrictEqual([
      ["a@example.com", "b@example.com"],
      ["b@example.com"],
    ]);
  });
});
