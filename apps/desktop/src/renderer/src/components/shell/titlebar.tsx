import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { FilesIcon, HouseIcon, SettingsIcon } from "lucide-react";

import TitlebarIndexButton from "@/components/mail/titlebar-index-button";
import TitlebarMailSearch from "@/components/shell/mail-search";
import TitlebarNewMessage from "@/components/shell/new-message";
import TitlebarSpamToggle from "@/components/shell/spam-toggle";
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

import TitlebarAccountSwitcher from "./titlebar/titlebar-account-switcher";

const Titlebar = () => {
  const { updates } = getRuntimeCapabilities();
  const selectedAccountId = useSelectedAccountId();
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const { openAllAccounts } = useMailboxNavigation();
  const allAccountsDisplay = getHotkeyDisplay("app.openAllAccounts");
  const settingsDisplay = getHotkeyDisplay("app.openSettings");
  const templatesDisplay = getHotkeyDisplay("app.openTemplates");

  const openSettings = (): void => {
    void navigate({ to: "/settings" });
  };

  const openTemplates = (): void => {
    void navigate({ to: "/templates" });
  };

  useAppCommand("app.openAllAccounts", openAllAccounts);
  useAppCommand("app.openSettings", openSettings);
  useAppCommand("app.openTemplates", openTemplates);

  return (
    <header className="app-titlebar bg-background fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-2">
      <div className="app-titlebar-interactive flex items-center gap-2">
        <TitlebarNewMessage />
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
                  matchRoute({ to: "/" }) && selectedAccountId === null
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
      <div className="app-titlebar-interactive flex items-center gap-1">
        <TitlebarIndexButton />
        <TitlebarMailSearch />
        <TitlebarUnreadToggle />
        <TitlebarSpamToggle />
        {updates === undefined ? null : (
          <TitlebarUpdateButton updateApi={updates} />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts={getHotkeyAriaLabel("app.openTemplates")}
                aria-label={templatesDisplay.label}
                onClick={openTemplates}
                size="icon"
                type="button"
                variant={
                  matchRoute({ to: "/templates" }) ? "secondary" : "ghost"
                }
              >
                <FilesIcon />
              </Button>
            }
          />
          <TooltipContent className="flex items-center gap-2" side="bottom">
            {templatesDisplay.label}
            <HotkeyHint command="app.openTemplates" />
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts={getHotkeyAriaLabel("app.openSettings")}
                aria-label="Settings"
                onClick={openSettings}
                size="icon"
                type="button"
                variant={
                  matchRoute({ to: "/settings" }) ? "secondary" : "ghost"
                }
              >
                <SettingsIcon />
              </Button>
            }
          />
          <TooltipContent className="flex items-center gap-2" side="bottom">
            {settingsDisplay.label}
            <HotkeyHint command="app.openSettings" />
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
};

export default Titlebar;
