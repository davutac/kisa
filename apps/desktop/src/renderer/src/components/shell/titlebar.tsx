import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { useMatchRoute, useNavigate } from "@tanstack/react-router";
import { HouseIcon, PlusIcon, SettingsIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import TitlebarAccountButton from "@/components/accounts/account-button";
import TitlebarIndexButton from "@/components/mail/titlebar-index-button";
import TitlebarMailSearch from "@/components/shell/mail-search";
import TitlebarNewMessage from "@/components/shell/new-message";
import TitlebarUnreadToggle from "@/components/shell/unread-toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import TitlebarUpdateButton from "@/components/updates/titlebar-update-button";
import {
  AppCommand,
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  OPEN_ACCOUNT_COMMAND_IDS,
  useAppCommand,
} from "@/hotkeys";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import { getRuntimeCapabilities } from "@/platform/desktop";
import { MAX_GOOGLE_ACCOUNTS } from "@/shared/ipc/auth";
import {
  useGoogleAccounts,
  useReorderGoogleAccounts,
} from "@/state/google-accounts";
import { useSelectedAccountId } from "@/state/mailbox";

const delayedAccountPointerSensor = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Delay({ tolerance: 6, value: 200 }),
  ],
});

const Titlebar = () => {
  const { auth, updates } = getRuntimeCapabilities();
  const accounts = useGoogleAccounts();
  const reorderAccounts = useReorderGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const matchRoute = useMatchRoute();
  const navigate = useNavigate();
  const { openAccount, openAllAccounts } = useMailboxNavigation();
  const canAddAccount = accounts.length < MAX_GOOGLE_ACCOUNTS;
  const accountCommands = accounts.map((account, index) => ({
    account,
    command: OPEN_ACCOUNT_COMMAND_IDS[index],
  }));
  const allAccountsDisplay = getHotkeyDisplay("app.openAllAccounts");
  const settingsDisplay = getHotkeyDisplay("app.openSettings");

  const openSettings = (): void => {
    void navigate({ to: "/settings" });
  };

  useAppCommand("app.openAllAccounts", openAllAccounts);
  useAppCommand("app.openSettings", openSettings);

  const addAccount = async (): Promise<void> => {
    if (auth === undefined || !canAddAccount) {
      return;
    }

    setIsAddingAccount(true);
    const reply = await auth.startGoogle();
    setIsAddingAccount(false);

    if (!reply.ok) {
      toast.error(reply.error);
    }
  };

  const finishAccountDrag = (event: DragEndEvent): void => {
    const { source } = event.operation;

    if (event.canceled || !isSortable(source)) {
      return;
    }

    const { index, initialIndex } = source;

    if (index === initialIndex) {
      return;
    }

    const reorderedAccounts = [...accounts];
    const [movedAccount] = reorderedAccounts.splice(initialIndex, 1);

    if (movedAccount === undefined) {
      return;
    }

    reorderedAccounts.splice(index, 0, movedAccount);
    void reorderAccounts(reorderedAccounts);
  };

  return (
    <header className="app-titlebar bg-background fixed inset-x-0 top-0 z-999 flex items-center justify-between gap-2">
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
        <div className="flex items-center gap-1">
          <DragDropProvider
            onDragEnd={finishAccountDrag}
            sensors={(defaults) => [
              ...defaults.filter((sensor) => sensor !== PointerSensor),
              delayedAccountPointerSensor,
            ]}
          >
            {accountCommands.map(({ account, command }, index) => (
              <Fragment key={account.email}>
                {command === undefined ? null : (
                  <AppCommand
                    callback={() => {
                      openAccount(account.email);
                    }}
                    command={command}
                  />
                )}
                <TitlebarAccountButton
                  account={account}
                  command={command}
                  index={index}
                />
              </Fragment>
            ))}
          </DragDropProvider>
          {auth === undefined || !canAddAccount ? null : (
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
        <TitlebarIndexButton />
        <TitlebarMailSearch />
        <TitlebarUnreadToggle />
        {updates === undefined ? null : (
          <TitlebarUpdateButton updateApi={updates} />
        )}
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
