import { useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useAppCommand } from "@/hotkeys";
import { undoneDrafts } from "@/mail/undo-send";
import { useLeaveMissingLabelPlace } from "@/mail/use-label-places";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import type { MailboxNavigation } from "@/mail/use-mailbox-navigation";
import { useUnreadFilter } from "@/mail/use-unread-filter";
import { getMailApi } from "@/platform/desktop";
import { useScheduledTitlebarState } from "@/scheduled/use-scheduled-titlebar-state";
import type { Mailbox } from "@/shared/ipc/mail";
import { useAccounts } from "@/state/accounts";
import { useMailbox, useSelectedAccountId } from "@/state/mailbox";

import {
  resolveMailboxSelection,
  resolveWorkspacePreviousPath,
  resolveWorkspaceToggle,
  shouldShowScheduled,
  toShellViewPath,
} from "./shell-navigation";
import type {
  MailboxTarget,
  MailboxView,
  ShellViewPath,
  WorkspacePath,
} from "./shell-navigation";
import { useShellHistory } from "./use-shell-history";
import type { ShellHistoryNavigation } from "./use-shell-history";

export interface ShellNavigation extends Omit<
  MailboxNavigation,
  "openMailbox"
> {
  /** Whether a new email can be written: some account and the mail API. */
  readonly canCompose: boolean;
  readonly history: ShellHistoryNavigation;
  readonly scheduledAttentionCount: number;
  /**
   * Opens a mailbox or label row, or leaves it for its scope's Inbox when on
   * screen.
   */
  readonly selectMailbox: (target: MailboxTarget) => void;
  readonly setUnreadFilter: (pressed: boolean) => void;
  readonly showUnread: boolean;
  readonly showScheduled: boolean;
  readonly toggleWorkspace: (target: WorkspacePath) => void;
  readonly view: MailboxView;
}

/**
 * The one owner of mailbox and workspace navigation for the main window. The
 * sidebar rows and their shortcuts both call these functions, and the
 * shortcuts are registered here so they keep working while the sidebar is
 * collapsed.
 */
export const useShellNavigation = (): ShellNavigation => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mailbox = useMailbox();
  const selectedAccountId = useSelectedAccountId();
  const { openAccount, openAllAccounts, openMailbox } = useMailboxNavigation();
  const { attentionCount, hasScheduledMail } = useScheduledTitlebarState();
  const { setUnreadFilter, showUnread } = useUnreadFilter();
  const accounts = useAccounts();
  const canCompose = getMailApi() !== undefined && accounts.length > 0;
  const previousPathsRef = useRef<Record<WorkspacePath, ShellViewPath | null>>({
    "/compose": null,
    "/scheduled": null,
    "/templates": null,
  });
  const currentPath = toShellViewPath(pathname);
  const view: MailboxView = { currentPath, mailbox, selectedAccountId };
  const history = useShellHistory(view, hasScheduledMail);
  useLeaveMissingLabelPlace();
  const showScheduled = shouldShowScheduled(
    currentPath === "/scheduled",
    hasScheduledMail
  );

  const toggleWorkspace = (targetPath: WorkspacePath): void => {
    const nextPath = resolveWorkspaceToggle({
      currentPath,
      previousPath: previousPathsRef.current[targetPath],
      targetPath,
    });

    if (currentPath !== targetPath) {
      previousPathsRef.current[targetPath] = resolveWorkspacePreviousPath(
        currentPath,
        targetPath,
        previousPathsRef.current["/compose"]
      );
    }

    void navigate({ to: nextPath });
  };

  // Undo send took a new email back: its page opens to take it up, and
  // closing it returns to wherever the user is by then. The latest toggle
  // and path are read when it happens, not when the email was sent.
  const latestRef = useRef({ currentPath, toggleWorkspace });
  useEffect(() => {
    latestRef.current = { currentPath, toggleWorkspace };
  });
  useEffect(
    () =>
      undoneDrafts.subscribe((state, previous) => {
        const latest = latestRef.current;
        if (
          state.compose !== undefined &&
          previous.compose === undefined &&
          latest.currentPath !== "/compose"
        ) {
          latest.toggleWorkspace("/compose");
        }
      }),
    []
  );

  const selectMailbox = (target: MailboxTarget): void => {
    const next = resolveMailboxSelection(view, target);
    openMailbox(next.accountId, next.mailbox);
  };
  // The mailbox shortcuts act on the current scope, exactly like choosing
  // that scope's row in the sidebar.
  const toggleMailbox = (target: Mailbox): void => {
    selectMailbox({ accountId: selectedAccountId, mailbox: target });
  };

  useAppCommand("app.composeMessage", () => toggleWorkspace("/compose"), {
    enabled: canCompose,
  });
  useAppCommand("app.openAllAccounts", openAllAccounts);
  useAppCommand("app.openScheduled", () => toggleWorkspace("/scheduled"), {
    enabled: showScheduled,
  });
  useAppCommand("app.openTemplates", () => toggleWorkspace("/templates"));
  useAppCommand("app.toggleSent", () => toggleMailbox("sent"));
  useAppCommand("app.toggleSpam", () => toggleMailbox("spam"));
  useAppCommand("app.toggleTrash", () => toggleMailbox("trash"));
  useAppCommand("app.toggleUnread", () => setUnreadFilter(!showUnread));

  return {
    canCompose,
    history,
    openAccount,
    openAllAccounts,
    scheduledAttentionCount: attentionCount,
    selectMailbox,
    setUnreadFilter,
    showScheduled,
    showUnread,
    toggleWorkspace,
    view,
  };
};
