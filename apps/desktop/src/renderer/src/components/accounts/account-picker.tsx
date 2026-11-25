import { ShuffleIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { Fragment } from "react";
import type { Ref } from "react";

import AccountProviderIcon from "@/components/accounts/account-provider-icon";
import { Toggle, ToggleGroup } from "@/components/ui/toggle";
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
import { cn } from "@/lib/utils";
import type { Account } from "@/shared/ipc/accounts";

interface AccountPickerBaseProps {
  readonly accounts: readonly Account[];
  /** Restyles the row, e.g. to sit on the page instead of a card. */
  readonly className?: string;
  readonly enableHotkeys?: boolean;
  readonly focusRefForAccount?: (accountId: string) => Ref<HTMLButtonElement>;
  readonly label?: string;
  readonly locked?: boolean;
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

interface AccountOptionToggleProps {
  readonly account?: Account;
  readonly ariaLabel: string;
  readonly command?: HotkeyCommandId;
  readonly description?: string;
  readonly focusRef?: Ref<HTMLButtonElement>;
  readonly isSelected: boolean;
  readonly label: string;
  readonly value: string;
}

// The group's value is a list of strings, so "no account" needs one that no
// address can be.
const NULL_OPTION_VALUE = "keep-current-account";

const AccountOptionAvatar = ({ account }: { account?: Account }) =>
  account === undefined ? (
    <ShuffleIcon className="size-3.5" />
  ) : (
    <AccountProviderIcon className="size-3.5" provider={account.provider} />
  );

const AccountOptionToggle = ({
  account,
  ariaLabel,
  command,
  description,
  focusRef,
  isSelected,
  label,
  value,
}: AccountOptionToggleProps) => {
  const shouldReduceMotion = useReducedMotionConfig();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-keyshortcuts={
              command === undefined ? undefined : getHotkeyAriaLabel(command)
            }
            aria-label={ariaLabel}
            className="h-7 min-w-7 shrink justify-start gap-0 overflow-visible rounded-full p-0"
            ref={focusRef}
            size="default"
            value={value}
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
          </Toggle>
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
    className,
    enableHotkeys = false,
    focusRefForAccount,
    label = "From",
    locked = false,
    nullOption,
    selectedAccountId,
  } = props;

  return (
    <div
      className={cn(
        "bg-card flex min-h-9 shrink-0 items-center px-4 py-1",
        className
      )}
    >
      <span className="text-muted-foreground w-10 shrink-0 text-xs/relaxed">
        {label}
      </span>
      {/* Arrow keys move between accounts; a press chooses one. Locked, the
          accounts stay reachable for their tooltips but can't be chosen. */}
      <ToggleGroup
        aria-label={`${label} account`}
        className="no-scrollbar min-w-0 overflow-x-auto"
        deselectable={false}
        disabled={locked}
        onValueChange={([next]) => {
          if (next === undefined) {
            return;
          }
          if (next !== NULL_OPTION_VALUE) {
            props.onSelect(next);
          } else if (props.nullOption !== undefined) {
            props.onSelect(null);
          }
        }}
        value={[selectedAccountId ?? NULL_OPTION_VALUE]}
      >
        {nullOption === undefined ? null : (
          <AccountOptionToggle
            ariaLabel={nullOption.label}
            description={nullOption.description}
            isSelected={selectedAccountId === null}
            label={nullOption.label}
            value={NULL_OPTION_VALUE}
          />
        )}
        {accounts.map((account, index) => {
          const command =
            enableHotkeys && !locked
              ? COMPOSER_ACCOUNT_COMMAND_IDS[index]
              : undefined;
          const selectAccount = (): void => props.onSelect(account.email);

          return (
            <Fragment key={account.email}>
              {command === undefined ? null : (
                <AppCommand callback={selectAccount} command={command} />
              )}
              <AccountOptionToggle
                account={account}
                ariaLabel={
                  locked ? `From ${account.email}` : `Select ${account.email}`
                }
                command={command}
                focusRef={focusRefForAccount?.(account.email)}
                isSelected={account.email === selectedAccountId}
                label={account.email}
                value={account.email}
              />
            </Fragment>
          );
        })}
      </ToggleGroup>
    </div>
  );
};

export default AccountPicker;
