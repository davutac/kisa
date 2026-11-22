import { PointerActivationConstraints, PointerSensor } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { PlusIcon } from "lucide-react";
import { Fragment } from "react";

import TitlebarAccountButton from "@/components/accounts/account-button";
import { openAccountSetup } from "@/components/accounts/open-account-setup";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AppCommand, OPEN_ACCOUNT_COMMAND_IDS } from "@/hotkeys";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import { getRuntimeCapabilities } from "@/platform/desktop";
import { useAccounts, useReorderAccounts } from "@/state/accounts";

const delayedAccountPointerSensor = PointerSensor.configure({
  activationConstraints: [
    new PointerActivationConstraints.Distance({ value: 15 }),
  ],
});

const TitlebarAccountSwitcher = () => {
  const { accounts: accountsApi } = getRuntimeCapabilities();
  const accounts = useAccounts();
  const reorderAccounts = useReorderAccounts();
  const { openAccount } = useMailboxNavigation();
  const accountCommands = accounts.map((account, index) => ({
    account,
    command: OPEN_ACCOUNT_COMMAND_IDS[index],
  }));

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
      {accountsApi === undefined ? null : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Add account"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => {
                  void openAccountSetup();
                }}
                size="icon"
                type="button"
                variant="ghost"
              >
                <PlusIcon className="size-4 stroke-[1.8]" />
              </Button>
            }
          />
          <TooltipContent side="bottom">Add account</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

export default TitlebarAccountSwitcher;
