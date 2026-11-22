import { isLabelPlace, isSameMailboxPlace } from "@/mail/mailbox-place";
import type { MailboxPlace } from "@/mail/mailbox-place";

import type { MailboxView, ShellViewPath } from "./shell-navigation";

/**
 * A place Go back and Go forward move between: the sidebar destinations. A
 * mailbox or label and Scheduled are scoped to an account; Settings,
 * Templates, and a new email are not, so their place ignores the scope left
 * underneath them. Conversations are not places; Escape already closes one.
 */
export type ShellPlace =
  | {
      readonly accountId: string | null;
      readonly kind: "mailbox";
      readonly mailbox: MailboxPlace;
    }
  | { readonly accountId: string | null; readonly kind: "scheduled" }
  | {
      readonly kind: "workspace";
      readonly path: "/compose" | "/settings" | "/templates";
    };

export interface ShellHistory {
  readonly entries: readonly ShellPlace[];
  readonly index: number;
  /**
   * The place a step is heading to. The mailbox store changes at once but the
   * route follows later, so the places in between are not recorded until the
   * step arrives or its navigation settles.
   */
  readonly pending: ShellPlace | null;
}

export type ShellHistoryDirection = -1 | 1;

/** Kept in memory only and capped, so it never grows with a long session. */
export const SHELL_HISTORY_LIMIT = 50;

export const toShellPlace = (view: MailboxView): ShellPlace => {
  if (view.currentPath === "/") {
    return {
      accountId: view.selectedAccountId,
      kind: "mailbox",
      mailbox: view.mailbox,
    };
  }

  if (view.currentPath === "/scheduled") {
    return { accountId: view.selectedAccountId, kind: "scheduled" };
  }

  return { kind: "workspace", path: view.currentPath };
};

export const isSameShellPlace = (a: ShellPlace, b: ShellPlace): boolean => {
  switch (a.kind) {
    case "mailbox": {
      return (
        b.kind === "mailbox" &&
        a.accountId === b.accountId &&
        isSameMailboxPlace(a.mailbox, b.mailbox)
      );
    }
    case "scheduled": {
      return b.kind === "scheduled" && a.accountId === b.accountId;
    }
    default: {
      return b.kind === "workspace" && a.path === b.path;
    }
  }
};

export const createShellHistory = (place: ShellPlace): ShellHistory => ({
  entries: [place],
  index: 0,
  pending: null,
});

/**
 * Records the place on screen. A new place drops anything ahead of the
 * current entry, as a browser does; arriving where a step was heading only
 * ends the step. Returns the same history when nothing changes.
 */
export const recordShellPlace = (
  history: ShellHistory,
  place: ShellPlace
): ShellHistory => {
  if (history.pending !== null) {
    return isSameShellPlace(place, history.pending)
      ? { ...history, pending: null }
      : history;
  }

  const current = history.entries[history.index];

  if (current !== undefined && isSameShellPlace(place, current)) {
    return history;
  }

  const entries = [...history.entries.slice(0, history.index + 1), place].slice(
    -SHELL_HISTORY_LIMIT
  );

  return { entries, index: entries.length - 1, pending: null };
};

/**
 * The entry a step lands on, skipping places that are already on screen or
 * no longer available, so neither button is a silent no-op.
 */
export const findShellHistoryStep = (
  history: ShellHistory,
  direction: ShellHistoryDirection,
  current: ShellPlace,
  isAvailable: (place: ShellPlace) => boolean
): number | undefined => {
  for (
    let index = history.index + direction;
    index >= 0 && index < history.entries.length;
    index += direction
  ) {
    const entry = history.entries[index];

    if (
      entry !== undefined &&
      isAvailable(entry) &&
      !isSameShellPlace(entry, current)
    ) {
      return index;
    }
  }

  return undefined;
};

export const beginShellHistoryStep = (
  history: ShellHistory,
  index: number
): ShellHistory => ({
  ...history,
  index,
  pending: history.entries[index] ?? null,
});

/**
 * Ends a step whose navigation has settled, even if it never arrived, say
 * because another navigation replaced it, so recording resumes.
 */
export const settleShellHistoryStep = (
  history: ShellHistory,
  target: ShellPlace
): ShellHistory =>
  history.pending === target ? { ...history, pending: null } : history;

export interface ShellPlaceAvailability {
  readonly accountIds: readonly string[];
  readonly hasScheduledMail: boolean;
  /**
   * Whether a label is known to be gone from the accounts of a scope, by the
   * same rule that moves a label place it vanished from to its Inbox.
   */
  readonly isLabelMissing: (
    label: string,
    scopeAccountIds: readonly string[]
  ) => boolean;
}

/**
 * A place whose account was disconnected is gone, a label is gone once its
 * scope no longer has it, and Scheduled is gone once nothing is scheduled,
 * the same as their sidebar rows and shortcuts.
 */
export const isShellPlaceAvailable = (
  place: ShellPlace,
  { accountIds, hasScheduledMail, isLabelMissing }: ShellPlaceAvailability
): boolean => {
  if (place.kind === "workspace") {
    return true;
  }

  if (place.kind === "scheduled" && !hasScheduledMail) {
    return false;
  }

  if (place.accountId !== null && !accountIds.includes(place.accountId)) {
    return false;
  }

  return !(
    place.kind === "mailbox" &&
    isLabelPlace(place.mailbox) &&
    isLabelMissing(
      place.mailbox.label,
      place.accountId === null ? accountIds : [place.accountId]
    )
  );
};

/** The store change a step makes before its route, if any. */
export type ShellScopeChange =
  | { readonly kind: "none" }
  | { readonly accountId: string | null; readonly kind: "account" }
  | {
      readonly accountId: string | null;
      readonly kind: "mailbox";
      readonly mailbox: MailboxPlace;
    };

export interface ShellPlaceStep {
  readonly path: ShellViewPath;
  readonly scope: ShellScopeChange;
}

/**
 * How to show a place from the current view. The scope changes only when the
 * place needs another one, because changing it closes the open conversation;
 * going back from Settings to the mailbox underneath keeps it, as closing
 * Settings does.
 */
export const planShellPlaceStep = (
  view: MailboxView,
  target: ShellPlace
): ShellPlaceStep => {
  if (target.kind === "workspace") {
    return { path: target.path, scope: { kind: "none" } };
  }

  if (target.kind === "scheduled") {
    return {
      path: "/scheduled",
      scope:
        target.accountId === view.selectedAccountId
          ? { kind: "none" }
          : { accountId: target.accountId, kind: "account" },
    };
  }

  return {
    path: "/",
    scope:
      target.accountId === view.selectedAccountId &&
      isSameMailboxPlace(target.mailbox, view.mailbox)
        ? { kind: "none" }
        : {
            accountId: target.accountId,
            kind: "mailbox",
            mailbox: target.mailbox,
          },
  };
};
