import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { PlusIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import TitlebarAccountButton from "@/components/accounts/account-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppCommand, OPEN_ACCOUNT_COMMAND_IDS } from "@/hotkeys";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import { getRuntimeCapabilities } from "@/platform/desktop";
import {
  useGoogleAccounts,
  useReorderGoogleAccounts,
} from "@/state/google-accounts";

const delayedAccountPointerSensor = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 15 }),
  ],
});

const TitlebarAccountSwitcher = () => {
  const { auth } = getRuntimeCapabilities();
  const accounts = useGoogleAccounts();
  const reorderAccounts = useReorderGoogleAccounts();
  const { openAccount } = useMailboxNavigation();
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const accountCommands = accounts.map((account, index) => ({
    account,
    command: OPEN_ACCOUNT_COMMAND_IDS[index],
  }));

  const handleAddGoogleAccount = async (): Promise<void> => {
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

  const handleAddOtherAccount = async (): Promise<void> => {
    const reply = await auth?.openAccountSetup();
    if (reply?.ok === false) {
      toast.error(reply.error);
    }
  };

  const handleAccountDrag = (event: DragEndEvent): void => {
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
    <div className="flex min-w-0 items-center gap-1">
      <div className="no-scrollbar scroll-fade-x min-w-0 flex-1 overflow-x-auto">
        <div className="flex w-max items-center gap-1">
          <DragDropProvider
            onDragEnd={handleAccountDrag}
            sensors={(defaults) => [
              ...defaults.filter((sensor) => sensor !== PointerSensor),
              delayedAccountPointerSensor,
            ]}
          >
            {accountCommands.map(({ account, command }, index) => (
              <Fragment key={account.email}>
                {command === undefined ? null : (
                  <AppCommand
                    callback={() => openAccount(account.email)}
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
        </div>
      </div>
      {auth === undefined ? null : (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      aria-label="Add account"
                      className="text-muted-foreground hover:text-foreground"
                      disabled={isAddingAccount}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <PlusIcon className="size-4 stroke-[1.8]" />
                    </Button>
                  }
                />
              }
            />
            <TooltipContent side="bottom">Add account</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onClick={handleAddGoogleAccount}>
              Add Google account
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleAddOtherAccount}>
              Add iCloud or other account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

export default TitlebarAccountSwitcher;
