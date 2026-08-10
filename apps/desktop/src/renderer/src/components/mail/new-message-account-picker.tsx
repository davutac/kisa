import { UserRoundIcon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";
import { Fragment } from "react";
import type { Ref } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AppCommand,
  COMPOSER_ACCOUNT_COMMAND_IDS,
  getHotkeyAriaLabel,
  HotkeyHint,
} from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import type { GoogleAccount } from "@/shared/ipc/auth";

interface AccountButtonProps {
  account: GoogleAccount;
  command?: HotkeyCommandId;
  focusRef?: Ref<HTMLButtonElement>;
  isSelected: boolean;
  onSelect: () => void;
}

const AccountButton = ({
  account,
  command,
  focusRef,
  isSelected,
  onSelect,
}: AccountButtonProps) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={
              command === undefined ? undefined : getHotkeyAriaLabel(command)
            }
            aria-label={`Send from ${account.email}`}
            aria-pressed={isSelected}
            className="h-7 min-w-7 justify-start gap-0 overflow-visible rounded-full p-0"
            onClick={onSelect}
            ref={focusRef}
            type="button"
            variant="secondary"
          >
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full">
              {account.avatarUrl === undefined ? (
                <UserRoundIcon className="size-3.5" />
              ) : (
                <img
                  alt=""
                  className="size-full object-cover"
                  src={account.avatarUrl}
                />
              )}
            </span>
            <m.span
              animate={
                isSelected
                  ? { opacity: 1, width: "auto" }
                  : { opacity: 0, width: 0 }
              }
              aria-hidden="true"
              className="block overflow-hidden"
              initial={false}
              transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.22)}
            >
              <span className="block max-w-48 truncate px-2.5 pl-1.5">
                {account.email}
              </span>
            </m.span>
          </Button>
        }
      />
      <TooltipContent className="flex items-start gap-2" side="bottom">
        <span className="flex flex-col">
          {account.displayName === undefined ? null : (
            <span>{account.displayName}</span>
          )}
          <span
            className={account.displayName === undefined ? "" : "opacity-70"}
          >
            {account.email}
          </span>
        </span>
        {command === undefined ? null : <HotkeyHint command={command} />}
      </TooltipContent>
    </Tooltip>
  );
};

interface NewMessageAccountPickerProps {
  accounts: readonly GoogleAccount[];
  focusRefForAccount?: (accountId: string) => Ref<HTMLButtonElement>;
  onSelect: (accountId: string) => void;
  selectedAccountId: string;
}

const NewMessageAccountPicker = ({
  accounts,
  focusRefForAccount,
  onSelect,
  selectedAccountId,
}: NewMessageAccountPickerProps) => (
  <div className="bg-card flex min-h-9 shrink-0 items-center px-4 py-1">
    <span className="text-muted-foreground w-10 shrink-0">From</span>
    <fieldset
      aria-label="From account"
      className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
    >
      {accounts.map((account, index) => {
        const command = COMPOSER_ACCOUNT_COMMAND_IDS[index];
        const selectAccount = (): void => onSelect(account.email);

        return (
          <Fragment key={account.email}>
            {command === undefined ? null : (
              <AppCommand callback={selectAccount} command={command} />
            )}
            <AccountButton
              account={account}
              command={command}
              focusRef={focusRefForAccount?.(account.email)}
              isSelected={account.email === selectedAccountId}
              onSelect={selectAccount}
            />
          </Fragment>
        );
      })}
    </fieldset>
  </div>
);

export default NewMessageAccountPicker;
