import { ShuffleIcon, UserRoundIcon } from "lucide-react";
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

interface AccountPickerBaseProps {
  readonly accounts: readonly GoogleAccount[];
  readonly enableHotkeys?: boolean;
  readonly focusRefForAccount?: (accountId: string) => Ref<HTMLButtonElement>;
  readonly label?: string;
}

interface RequiredAccountPickerProps extends AccountPickerBaseProps {
  readonly nullOption?: undefined;
  readonly onSelect: (accountId: string) => void;
  readonly selectedAccountId: string;
}

interface NullableAccountPickerProps extends AccountPickerBaseProps {
  readonly nullOption: {
    readonly description: string;
    readonly label: string;
  };
  readonly onSelect: (accountId: string | null) => void;
  readonly selectedAccountId: string | null;
}

type AccountPickerProps =
  | NullableAccountPickerProps
  | RequiredAccountPickerProps;

interface AccountOptionButtonProps {
  readonly account?: GoogleAccount;
  readonly ariaLabel: string;
  readonly command?: HotkeyCommandId;
  readonly description?: string;
  readonly focusRef?: Ref<HTMLButtonElement>;
  readonly isSelected: boolean;
  readonly label: string;
  readonly onSelect: () => void;
}

const AccountOptionAvatar = ({ account }: { account?: GoogleAccount }) => {
  if (account === undefined) {
    return <ShuffleIcon className="size-3.5" />;
  }
  if (account.avatarUrl === undefined) {
    return <UserRoundIcon className="size-3.5" />;
  }
  return (
    <img alt="" className="size-full object-cover" src={account.avatarUrl} />
  );
};

const AccountOptionButton = ({
  account,
  ariaLabel,
  command,
  description,
  focusRef,
  isSelected,
  label,
  onSelect,
}: AccountOptionButtonProps) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-keyshortcuts={
              command === undefined ? undefined : getHotkeyAriaLabel(command)
            }
            aria-label={ariaLabel}
            aria-pressed={isSelected}
            className="h-7 min-w-7 shrink justify-start gap-0 overflow-visible rounded-full p-0"
            onClick={onSelect}
            ref={focusRef}
            type="button"
            variant="secondary"
          >
            <span className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-full">
              <AccountOptionAvatar account={account} />
            </span>
            <m.span
              animate={
                isSelected
                  ? { opacity: 1, width: "auto" }
                  : { opacity: 0, width: 0 }
              }
              aria-hidden="true"
              className="block min-w-0 overflow-hidden"
              initial={false}
              transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.22)}
            >
              <span className="block truncate px-2.5 pl-1.5">{label}</span>
            </m.span>
          </Button>
        }
      />
      <TooltipContent className="flex items-start gap-2" side="bottom">
        <span className="flex flex-col">
          {account?.displayName === undefined ? null : (
            <span>{account.displayName}</span>
          )}
          <span
            className={account?.displayName === undefined ? "" : "opacity-70"}
          >
            {label}
          </span>
          {description === undefined ? null : (
            <span className="opacity-70">{description}</span>
          )}
        </span>
        {command === undefined ? null : <HotkeyHint command={command} />}
      </TooltipContent>
    </Tooltip>
  );
};

const AccountPicker = (props: AccountPickerProps) => {
  const {
    accounts,
    enableHotkeys = false,
    focusRefForAccount,
    label = "From",
    nullOption,
    selectedAccountId,
  } = props;

  return (
    <div className="bg-card flex min-h-9 shrink-0 items-center px-4 py-1">
      <span className="text-muted-foreground w-10 shrink-0 text-xs/relaxed">
        {label}
      </span>
      <fieldset
        aria-label={`${label} account`}
        className="no-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {nullOption === undefined ? null : (
          <AccountOptionButton
            ariaLabel={nullOption.label}
            description={nullOption.description}
            isSelected={selectedAccountId === null}
            label={nullOption.label}
            onSelect={() => props.onSelect(null)}
          />
        )}
        {accounts.map((account, index) => {
          const command = enableHotkeys
            ? COMPOSER_ACCOUNT_COMMAND_IDS[index]
            : undefined;
          const selectAccount = (): void => props.onSelect(account.email);

          return (
            <Fragment key={account.email}>
              {command === undefined ? null : (
                <AppCommand callback={selectAccount} command={command} />
              )}
              <AccountOptionButton
                account={account}
                ariaLabel={`Select ${account.email}`}
                command={command}
                focusRef={focusRefForAccount?.(account.email)}
                isSelected={account.email === selectedAccountId}
                label={account.email}
                onSelect={selectAccount}
              />
            </Fragment>
          );
        })}
      </fieldset>
    </div>
  );
};

export default AccountPicker;
