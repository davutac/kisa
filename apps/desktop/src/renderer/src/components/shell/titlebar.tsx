import { useLocation, useNavigate } from "@tanstack/react-router";
import { FilesIcon, HouseIcon, SettingsIcon } from "lucide-react";
import { useRef } from "react";

import TitlebarIndexButton from "@/components/mail/titlebar-index-button";
import TitlebarMailSearch from "@/components/shell/mail-search";
import TitlebarNewMessage from "@/components/shell/new-message";
import TitlebarSentToggle from "@/components/shell/sent-toggle";
import TitlebarSpamToggle from "@/components/shell/spam-toggle";
import TitlebarTrashToggle from "@/components/shell/trash-toggle";
import TitlebarUnreadToggle from "@/components/shell/unread-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import TitlebarUpdateButton from "@/components/updates/titlebar-update-button";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import { getRuntimeCapabilities } from "@/platform/desktop";
import { useSelectedAccountId } from "@/state/mailbox";

import {
  resolveTitlebarViewToggle,
  toTitlebarViewPath,
} from "./titlebar-view-toggle";
import type {
  TitlebarViewPath,
  TitlebarWorkspacePath,
} from "./titlebar-view-toggle";
import TitlebarAccountSwitcher from "./titlebar/titlebar-account-switcher";
import TitlebarWorkspaceButton from "./titlebar/titlebar-workspace-button";

const Titlebar = () => {
  const { updates } = getRuntimeCapabilities();
  const selectedAccountId = useSelectedAccountId();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const previousPathsRef = useRef<
    Record<TitlebarWorkspacePath, TitlebarViewPath | null>
  >({
    "/settings": null,
    "/templates": null,
  });
  const { openAllAccounts } = useMailboxNavigation();
  const allAccountsDisplay = getHotkeyDisplay("app.openAllAccounts");
  const currentPath = toTitlebarViewPath(pathname);
  const isSettingsOpen = currentPath === "/settings";
  const isTemplatesOpen = currentPath === "/templates";

  const toggleView = (targetPath: TitlebarWorkspacePath): void => {
    const previousPath = previousPathsRef.current[targetPath];
    const nextPath = resolveTitlebarViewToggle({
      currentPath,
      previousPath,
      targetPath,
    });

    if (currentPath !== targetPath) {
      previousPathsRef.current[targetPath] = currentPath;
    }

    void navigate({ to: nextPath });
  };

  const toggleSettings = (): void => toggleView("/settings");
  const toggleTemplates = (): void => toggleView("/templates");

  useAppCommand("app.openAllAccounts", openAllAccounts);

  return (
    <header className="app-titlebar bg-background fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-2">
      <div className="flex items-center gap-3">
        <TitlebarNewMessage />
        <div className="app-titlebar-interactive flex min-w-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-keyshortcuts={getHotkeyAriaLabel("app.openAllAccounts")}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={openAllAccounts}
                  size="icon"
                  type="button"
                  variant={
                    currentPath === "/" && selectedAccountId === null
                      ? "secondary"
                      : "ghost"
                  }
                >
                  <HouseIcon className="size-4 stroke-[1.8]" />
                  <span className="sr-only">All accounts</span>
                </Button>
              }
            />
            <TooltipContent className="flex items-center gap-2" side="bottom">
              {allAccountsDisplay.label}
              <HotkeyHint command="app.openAllAccounts" />
            </TooltipContent>
          </Tooltip>
          <TitlebarAccountSwitcher />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="app-titlebar-interactive flex items-center gap-1">
          <TitlebarIndexButton />
          {updates === undefined ? null : (
            <TitlebarUpdateButton updateApi={updates} />
          )}
        </div>
        <div className="app-titlebar-interactive flex min-w-0 items-center gap-1">
          <TitlebarMailSearch />
          <TitlebarUnreadToggle />
          <TitlebarSentToggle />
          <TitlebarSpamToggle />
          <TitlebarTrashToggle />
        </div>
        <div className="app-titlebar-interactive flex min-w-0 items-center gap-1">
          <TitlebarWorkspaceButton
            command="app.openTemplates"
            isOpen={isTemplatesOpen}
            onToggle={toggleTemplates}
          >
            <FilesIcon />
          </TitlebarWorkspaceButton>
          <TitlebarWorkspaceButton
            command="app.openSettings"
            isOpen={isSettingsOpen}
            onToggle={toggleSettings}
          >
            <SettingsIcon />
          </TitlebarWorkspaceButton>
        </div>
      </div>
    </header>
  );
};

export default Titlebar;
