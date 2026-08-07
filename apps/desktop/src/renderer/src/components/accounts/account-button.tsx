import { UserRoundIcon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { useIsAccountSyncing } from "@/mail/use-mail-sync-state";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useSelectedAccountId } from "@/state/mailbox";

interface TitlebarAccountButtonProps {
  account: GoogleAccount;
  shortcut?: string;
}

const TitlebarAccountButton = ({
  account,
  shortcut,
}: TitlebarAccountButtonProps) => {
  const { openAccount } = useMailboxNavigation();
  const selectedAccountId = useSelectedAccountId();
  const shouldReduceMotion = useReducedMotion();
  const isSyncing = useIsAccountSyncing(account.email);
  const isActive = selectedAccountId === account.email;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-busy={isSyncing}
            aria-keyshortcuts={shortcut}
            aria-label={account.email}
            className="h-7 min-w-7 justify-start gap-0 overflow-hidden rounded-full p-0"
            onClick={() => {
              openAccount(account.email);
            }}
            type="button"
            variant="secondary"
          >
            <span className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-full">
              {account.avatarUrl === undefined ? (
                <UserRoundIcon aria-hidden="true" className="size-3.5" />
              ) : (
                <img
                  alt=""
                  className="size-full object-cover"
                  src={account.avatarUrl}
                />
              )}
              {isSyncing ? (
                <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/45">
                  <Spinner className="size-4 text-white" />
                </span>
              ) : null}
            </span>
            <m.span
              animate={
                isActive
                  ? { opacity: 1, width: "auto" }
                  : { opacity: 0, width: 0 }
              }
              aria-hidden="true"
              className="block overflow-hidden"
              initial={false}
              transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.22)}
            >
              <span className="block px-2.5 pl-1.5">{account.email}</span>
            </m.span>
          </Button>
        }
      />
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {account.displayName === undefined ? (
          account.email
        ) : (
          <span className="flex flex-col">
            <span>{account.displayName}</span>
            <span className="opacity-70">{account.email}</span>
          </span>
        )}
        {shortcut === undefined ? null : <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarAccountButton;
