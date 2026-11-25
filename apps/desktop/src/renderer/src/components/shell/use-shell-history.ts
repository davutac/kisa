import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { useAppCommand } from "@/hotkeys";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { retainMailboxThreadsSnapshotsForAccounts } from "@/mail/mailbox-cache";
import { useIsLabelMissing } from "@/mail/use-label-places";
import { useAccounts } from "@/state/accounts";
import { useMailboxStore } from "@/state/mailbox";

import {
  beginShellHistoryStep,
  createShellHistory,
  findShellHistoryStep,
  isShellPlaceAvailable,
  planShellPlaceStep,
  recordShellPlace,
  settleShellHistoryStep,
  toShellPlace,
} from "./shell-history";
import type { ShellPlace } from "./shell-history";
import type { MailboxView } from "./shell-navigation";

export interface ShellHistoryNavigation {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly goBack: () => void;
  readonly goForward: () => void;
}

/**
 * Go back and Go forward through the sidebar places visited in this window.
 * It records whatever moved the view, whether a row, a shortcut, or a step,
 * so every path into a place is remembered the same way. A step leaves the
 * Unread filter alone, as choosing a mailbox row does.
 */
export const useShellHistory = (
  view: MailboxView,
  hasScheduledMail: boolean
): ShellHistoryNavigation => {
  const navigate = useNavigate();
  const accounts = useAccounts();
  const isLabelMissing = useIsLabelMissing();
  const selectAccount = useMailboxStore((state) => state.selectAccount);
  const selectMailbox = useMailboxStore((state) => state.selectMailbox);
  const place = toShellPlace(view);
  const [history, setHistory] = useState(() => createShellHistory(place));
  const recorded = recordShellPlace(history, place);

  // Recording while rendering follows the place on screen without an effect.
  // It settles in one pass: recording the same place again changes nothing.
  if (recorded !== history) {
    setHistory(recorded);
  }

  const accountIds = accounts.map(({ email }) => email);

  const isAvailable = (target: ShellPlace): boolean =>
    isShellPlaceAvailable(target, {
      accountIds,
      hasScheduledMail,
      isLabelMissing,
    });

  const backIndex = findShellHistoryStep(recorded, -1, place, isAvailable);
  const forwardIndex = findShellHistoryStep(recorded, 1, place, isAvailable);

  const showPlace = async (target: ShellPlace): Promise<void> => {
    const { path, scope } = planShellPlaceStep(view, target);

    if (scope.kind !== "none") {
      if (scope.accountId !== view.selectedAccountId) {
        retainMailboxThreadsSnapshotsForAccounts(
          scope.accountId === null ? accountIds : [scope.accountId]
        );
      }

      if (scope.kind === "mailbox") {
        selectMailbox(scope.accountId, scope.mailbox);
      } else {
        selectAccount(scope.accountId);
      }
    }

    if (path !== view.currentPath) {
      await navigate({ to: path });
    }
  };

  const step = (index: number | undefined): void => {
    const target = index === undefined ? undefined : recorded.entries[index];

    if (index === undefined || target === undefined) {
      return;
    }

    setHistory(beginShellHistoryStep(recorded, index));
    void runWithCleanup(
      () => showPlace(target),
      () => {
        setHistory((current) => settleShellHistoryStep(current, target));
      }
    );
  };

  const goBack = (): void => step(backIndex);
  const goForward = (): void => step(forwardIndex);

  useAppCommand("app.navigateBack", goBack, {
    enabled: backIndex !== undefined,
  });
  useAppCommand("app.navigateForward", goForward, {
    enabled: forwardIndex !== undefined,
  });

  return {
    canGoBack: backIndex !== undefined,
    canGoForward: forwardIndex !== undefined,
    goBack,
    goForward,
  };
};
