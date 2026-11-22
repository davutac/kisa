import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AppCommand, OPEN_ACCOUNT_COMMAND_IDS, useAppCommand } from "@/hotkeys";
import { useAccounts } from "@/state/accounts";
import { useMailSearchStore } from "@/state/mail-search";

import { ShellWorkspaceContext } from "./shell-workspace";
import AppSidebar from "./sidebar/app-sidebar";
import {
  readSidebarOpen,
  writeSidebarOpen,
} from "./sidebar/sidebar-preferences";
import Titlebar from "./titlebar";
import { TitlebarSlotContext } from "./titlebar-slot";
import { useShellNavigation } from "./use-shell-navigation";

/** Registers `Mod+2`–`Mod+9` for the first eight accounts, after All accounts. */
const AccountCommands = ({
  openAccount,
}: {
  readonly openAccount: (accountEmail: string) => void;
}) => {
  const accounts = useAccounts();

  return OPEN_ACCOUNT_COMMAND_IDS.map((command, index) => {
    const account = accounts[index];

    return account === undefined ? null : (
      <AppCommand
        callback={() => openAccount(account.email)}
        command={command}
        key={command}
      />
    );
  });
};

/**
 * The main window: a collapsible sidebar beside the content column. Whether
 * the sidebar is open is remembered across launches. Every place, including
 * a new email, is a route shown in the content column.
 */
const AppShell = ({ children }: { readonly children: ReactNode }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(readSidebarOpen);
  const hasToggledSidebarRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarOpenButtonRef = useRef<HTMLButtonElement>(null);
  // State rather than a ref so views render into the slot once it mounts.
  const [titlebarSlot, setTitlebarSlot] = useState<HTMLDivElement | null>(null);
  const navigation = useShellNavigation();
  const { canCompose, toggleWorkspace, view } = navigation;
  const isComposing = view.currentPath === "/compose";
  const toggleComposer = (): void => {
    toggleWorkspace("/compose");
  };

  const isSearchActive = useMailSearchStore((state) => state.isActive);
  const exitSearch = useMailSearchStore((state) => state.exit);

  // The query of the results in the list, and the × that clears them, live in
  // the sidebar, so hiding the sidebar ends the search rather than leaving
  // results on screen with nothing naming or closing them.
  const toggleSidebar = useCallback((): void => {
    hasToggledSidebarRef.current = true;
    if (isSidebarOpen && isSearchActive) {
      exitSearch();
    }
    setIsSidebarOpen(!isSidebarOpen);
    writeSidebarOpen(!isSidebarOpen);
  }, [exitSearch, isSearchActive, isSidebarOpen]);
  // Showing search results reveals the sidebar while the closing search bar
  // hands focus back, so this skips the focus hand-off a toggle would make.
  const revealSidebar = useCallback((): void => {
    hasToggledSidebarRef.current = false;
    setIsSidebarOpen(true);
    writeSidebarOpen(true);
  }, []);

  useAppCommand("app.toggleSidebar", toggleSidebar);

  // Collapsing makes the sidebar inert and expanding unmounts the titlebar's
  // toggle, so focus left on either would fall back to the document. Hand it
  // to the toggle that is now visible; focus elsewhere, such as the search
  // field, stays where it is.
  useEffect(() => {
    if (!hasToggledSidebarRef.current) {
      return;
    }

    const active = document.activeElement;
    const isStranded =
      active === null ||
      active === document.body ||
      (!isSidebarOpen && sidebarRef.current?.contains(active) === true);

    if (isStranded) {
      (isSidebarOpen
        ? sidebarCloseButtonRef
        : sidebarOpenButtonRef
      ).current?.focus();
    }
  }, [isSidebarOpen]);

  return (
    <div className="flex h-svh scroll-smooth antialiased">
      <AppSidebar
        canCompose={canCompose}
        isComposing={isComposing}
        isOpen={isSidebarOpen}
        navigation={navigation}
        onReveal={revealSidebar}
        onToggle={toggleSidebar}
        onToggleComposer={toggleComposer}
        sidebarRef={sidebarRef}
        toggleButtonRef={sidebarCloseButtonRef}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Titlebar
          canCompose={canCompose}
          history={navigation.history}
          isComposing={isComposing}
          isSidebarOpen={isSidebarOpen}
          onToggleComposer={toggleComposer}
          onToggleSidebar={toggleSidebar}
          sidebarToggleRef={sidebarOpenButtonRef}
          slotRef={setTitlebarSlot}
        />
        <main className="scroll-fade-y flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
          <ShellWorkspaceContext.Provider value={toggleWorkspace}>
            <TitlebarSlotContext.Provider value={titlebarSlot}>
              {children}
            </TitlebarSlotContext.Provider>
          </ShellWorkspaceContext.Provider>
        </main>
      </div>
      <AccountCommands openAccount={navigation.openAccount} />
    </div>
  );
};

export default AppShell;
