import { FilesIcon } from "lucide-react";
import { useRef } from "react";
import type { Ref } from "react";

import type { DialogController } from "@/components/ui/dialog";
import SidebarUpdateButton from "@/components/updates/sidebar-update-button";
import { APP_NAME } from "@/constants";
import { useHotkeyHintsRevealed } from "@/hotkeys";
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
import SidebarFrame from "./sidebar-frame";
import SidebarMailSearch from "./sidebar-mail-search";
import SidebarScheduledRow from "./sidebar-scheduled-row";
import SidebarSettingsButton from "./sidebar-settings-button";
import SidebarUnreadToggle from "./sidebar-unread-toggle";
import SidebarWorkspaceButton from "./sidebar-workspace-button";

interface AppSidebarProps {
  readonly canCompose: boolean;
  readonly isComposing: boolean;
  readonly isOpen: boolean;
  readonly navigation: ShellNavigation;
  /** Opens the composer, or leaves it when it is already open. */
  readonly onToggleComposer: () => void;
  readonly onReveal: () => void;
  readonly onToggle: () => void;
  readonly settingsDialog: DialogController;
  readonly sidebarRef: Ref<HTMLElement>;
  readonly toggleButtonRef: Ref<HTMLButtonElement>;
}

/**
 * The main window's navigation. It stays mounted while collapsed, made inert
 * and zero-width, so its scroll position and drag state survive; its rows
 * keep their width while it collapses, so they never reflow, and dragging its
 * trailing edge resizes it. The shell owns the navigation shortcuts these
 * rows advertise; the search row owns `Mod+K`, which opens its command bar
 * over the window even while hidden.
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
  settingsDialog,
  sidebarRef,
  toggleButtonRef,
}: AppSidebarProps) => {
  const areHotkeyHintsRevealed = useHotkeyHintsRevealed(isOpen);
  const historyButtonsRef = useRef<HTMLDivElement>(null);
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
    <SidebarFrame
      isHotkeyHintsRevealed={areHotkeyHintsRevealed}
      isOpen={isOpen}
      minWidthAnchorRef={historyButtonsRef}
      sidebarRef={sidebarRef}
    >
      {/* The name stays outside the interactive groups, so it drags the
          window like the rest of the strip. It never truncates: the sidebar's
          minimum width is measured from where the strip ends. */}
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
        <span className="text-sidebar-foreground shrink-0 px-1 text-[13px] font-semibold whitespace-nowrap select-none">
          {APP_NAME}
        </span>
        <div
          className="app-titlebar-interactive flex items-center"
          ref={historyButtonsRef}
        >
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
        className="scroll-fade-y flex min-h-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-2 pb-2"
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
        <SidebarSettingsButton controller={settingsDialog} />
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
    </SidebarFrame>
  );
};

export default AppSidebar;
