import { FilesIcon, SettingsIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import type { Ref } from "react";

import SidebarUpdateButton from "@/components/updates/sidebar-update-button";
import { APP_NAME } from "@/constants";
import { useHotkeyHintsRevealed } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { getRuntimeCapabilities } from "@/platform/desktop";

import {
  HistoryButtons,
  NewMessageButton,
  SidebarToggleButton,
} from "../shell-buttons";
import type { ShellNavigation } from "../use-shell-navigation";
import { WindowTitlebar } from "../window-titlebar";
import SidebarAccounts from "./sidebar-accounts";
import SidebarAddAccountButton from "./sidebar-add-account-button";
import SidebarFavorites from "./sidebar-favorites";
import SidebarMailSearch from "./sidebar-mail-search";
import SidebarScheduledRow from "./sidebar-scheduled-row";
import SidebarUnreadToggle from "./sidebar-unread-toggle";
import SidebarWorkspaceButton from "./sidebar-workspace-button";

/** Matches the inner panel's `w-60`, so collapsing never reflows the rows. */
const SIDEBAR_WIDTH = "15rem";

interface AppSidebarProps {
  readonly canCompose: boolean;
  readonly isComposing: boolean;
  readonly isOpen: boolean;
  readonly navigation: ShellNavigation;
  /** Opens the composer, or leaves it when it is already open. */
  readonly onToggleComposer: () => void;
  readonly onReveal: () => void;
  readonly onToggle: () => void;
  readonly sidebarRef: Ref<HTMLElement>;
  readonly toggleButtonRef: Ref<HTMLButtonElement>;
}

/**
 * The main window's navigation. It stays mounted while collapsed, made inert
 * and zero-width, so its scroll position and drag state survive. The shell
 * owns the navigation shortcuts these rows advertise; the search row owns
 * `Mod+K`, which opens its command bar over the window even while hidden.
 * Holding `Mod` sets `data-hotkey-hints`, which shows each row's shortcut in
 * place of its trailing content.
 */
const AppSidebar = ({
  canCompose,
  isComposing,
  isOpen,
  navigation,
  onToggleComposer,
  onReveal,
  onToggle,
  sidebarRef,
  toggleButtonRef,
}: AppSidebarProps) => {
  const shouldReduceMotion = useReducedMotionConfig();
  const areHotkeyHintsRevealed = useHotkeyHintsRevealed(isOpen);
  const { updates } = getRuntimeCapabilities();
  const {
    openAccount,
    openAllAccounts,
    scheduledAttentionCount,
    selectMailbox,
    setUnreadFilter,
    showScheduled,
    showUnread,
    toggleWorkspace,
    view,
  } = navigation;

  return (
    <m.aside
      animate={{ width: isOpen ? SIDEBAR_WIDTH : 0 }}
      aria-label="Sidebar"
      className="flex h-full shrink-0 justify-end overflow-hidden"
      data-hotkey-hints={areHotkeyHintsRevealed ? "" : undefined}
      inert={!isOpen}
      initial={false}
      ref={sidebarRef}
      transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.2)}
    >
      <div className="bg-sidebar text-sidebar-foreground border-sidebar-border flex h-full w-60 shrink-0 flex-col border-r">
        {/* The name stays outside the interactive groups, so it drags the
            window like the rest of the strip. */}
        <WindowTitlebar
          as="div"
          className="flex shrink-0 items-center gap-1"
          controls="leading"
        >
          <div className="app-titlebar-interactive flex items-center">
            <SidebarToggleButton
              buttonRef={toggleButtonRef}
              isSidebarOpen
              onToggle={onToggle}
            />
          </div>
          <span className="text-sidebar-foreground truncate px-1 text-[13px] font-semibold select-none">
            {APP_NAME}
          </span>
          <div className="app-titlebar-interactive flex items-center">
            <HistoryButtons history={navigation.history} />
          </div>
        </WindowTitlebar>
        <div className="shrink-0 px-2 pt-1 pb-2">
          <SidebarMailSearch
            actions={
              <>
                <SidebarUnreadToggle
                  onPressedChange={setUnreadFilter}
                  pressed={showUnread}
                />
                <NewMessageButton
                  canOpen={canCompose}
                  isOpen={isComposing}
                  onToggle={onToggleComposer}
                  placement="sidebar"
                />
              </>
            }
            onReveal={onReveal}
          />
        </div>
        <nav
          aria-label="Mailboxes and accounts"
          className="scroll-fade-y flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2"
        >
          <SidebarFavorites onSelect={selectMailbox} view={view} />
          {showScheduled ? (
            <ul className="flex flex-col gap-0.5">
              <li>
                <SidebarScheduledRow
                  attentionCount={scheduledAttentionCount}
                  isCurrent={view.currentPath === "/scheduled"}
                  onSelect={() => toggleWorkspace("/scheduled")}
                />
              </li>
            </ul>
          ) : null}
          <SidebarAccounts
            onOpenAccount={openAccount}
            onOpenAllAccounts={openAllAccounts}
            onSelectMailbox={selectMailbox}
            view={view}
          />
        </nav>
        <div className="flex shrink-0 items-center gap-1 px-2 pt-1 pb-2">
          <SidebarWorkspaceButton
            command="app.openSettings"
            isOpen={view.currentPath === "/settings"}
            onToggle={() => toggleWorkspace("/settings")}
          >
            <SettingsIcon className="stroke-[1.8]" />
          </SidebarWorkspaceButton>
          <SidebarWorkspaceButton
            command="app.openTemplates"
            isOpen={view.currentPath === "/templates"}
            onToggle={() => toggleWorkspace("/templates")}
          >
            <FilesIcon className="stroke-[1.8]" />
          </SidebarWorkspaceButton>
          <div className="ml-auto flex items-center gap-1">
            {updates === undefined ? null : (
              <SidebarUpdateButton updateApi={updates} />
            )}
            <SidebarAddAccountButton />
          </div>
        </div>
      </div>
    </m.aside>
  );
};

export default AppSidebar;
