import { useHotkeys } from "@tanstack/react-hotkeys";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { HouseIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import TitlebarAccountButton from "@/components/accounts/account-button";
import TitlebarMailSearch from "@/components/shell/mail-search";
import TitlebarUnreadToggle from "@/components/shell/unread-toggle";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import TitlebarUpdateButton from "@/components/updates/titlebar-update-button";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import { getRuntimeCapabilities } from "@/platform/desktop";
import {
  ALL_ACCOUNTS_SHORTCUT,
  getAccountShortcut,
  SETTINGS_SHORTCUT,
} from "@/shell/titlebar-shortcuts";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useSelectedAccountId } from "@/state/mailbox";

const Titlebar = () => {
  const { auth, updates } = getRuntimeCapabilities();
  const accounts = useGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const { openAccount, openAllAccounts } = useMailboxNavigation();
  const accountShortcuts = accounts.map((account, index) => ({
    account,
    shortcut: getAccountShortcut(index),
  }));

  const openSettings = (): void => {
    void navigate({ to: "/settings" });
  };

  useHotkeys([
    { callback: openAllAccounts, hotkey: ALL_ACCOUNTS_SHORTCUT },
    { callback: openSettings, hotkey: SETTINGS_SHORTCUT },
    ...accountShortcuts.flatMap(({ account, shortcut }) =>
      shortcut === undefined
        ? []
        : [
            {
              callback: () => {
                openAccount(account.email);
              },
              hotkey: shortcut,
            },
          ]
    ),
  ]);

  const addAccount = async (): Promise<void> => {
    if (auth === undefined) {
      return;
    }

    setIsAddingAccount(true);
    const reply = await auth.startGoogle();
    setIsAddingAccount(false);

    if (!reply.ok) {
      toast.error(reply.error);
    }
  };

  return (
    <header className="app-titlebar border-border/70 bg-background fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-2 border-b">
      <div className="app-titlebar-interactive flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts={ALL_ACCOUNTS_SHORTCUT}
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
            All accounts
            <Kbd>{ALL_ACCOUNTS_SHORTCUT}</Kbd>
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-1">
          {accountShortcuts.map(({ account, shortcut }) => (
            <TitlebarAccountButton
              account={account}
              key={account.email}
              shortcut={shortcut}
            />
          ))}
          {auth === undefined ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Add Google account"
                    className="text-muted-foreground hover:text-foreground"
                    disabled={isAddingAccount}
                    onClick={() => {
                      void addAccount();
                    }}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <PlusIcon className="size-4 stroke-[1.8]" />
                  </Button>
                }
              />
              <TooltipContent side="bottom">Add Google account</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="app-titlebar-interactive flex items-center gap-1">
        <TitlebarMailSearch />
        <TitlebarUnreadToggle />
        {updates === undefined ? null : (
          <TitlebarUpdateButton updateApi={updates} />
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts={SETTINGS_SHORTCUT}
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
            Settings
            <Kbd>{SETTINGS_SHORTCUT}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
};

export default Titlebar;
