import { useSortable } from "@dnd-kit/react/sortable";
import { UserRoundIcon } from "lucide-react";
import { m, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHotkeyAriaLabel, HotkeyHint } from "@/hotkeys";
import type { HotkeyCommandId } from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import { useHasUnreadMail } from "@/mail/use-has-unread-mail";
import { useAccountIndexProgress } from "@/mail/use-mail-index-progress";
import { useIsAccountSyncing } from "@/mail/use-mail-sync-state";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useSelectedAccountId } from "@/state/mailbox";

interface TitlebarAccountButtonProps {
  account: GoogleAccount;
  command?: HotkeyCommandId;
  index: number;
}

const TitlebarAccountButton = ({
  account,
  command,
  index,
}: TitlebarAccountButtonProps) => {
  const { ref, targetRef } = useSortable({
    id: account.email,
    index,
  });
  const { openAccount } = useMailboxNavigation();
  const selectedAccountId = useSelectedAccountId();
  const shouldReduceMotion = useReducedMotion();
  const hasUnreadMail = useHasUnreadMail(account.email);
  const isSyncing = useIsAccountSyncing(account.email);
  const indexProgress = useAccountIndexProgress(account.email);
  const isActive = selectedAccountId === account.email;
  const isIndexing = indexProgress?.status === "running";
  // Gmail's own total is an estimate and the indexer re-walks a day of overlap
  // on resume, so the ratio is clamped rather than trusted to stay under one.
  const indexedRatio =
    indexProgress === undefined ||
    indexProgress.estimatedThreads === undefined ||
    indexProgress.estimatedThreads <= 0
      ? undefined
      : Math.min(
          1,
          indexProgress.indexedThreads / indexProgress.estimatedThreads
        );

  // The button is the sortable DOM item, while the avatar stays the fixed-size
  // collision target so an expanded account label cannot block position one.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-busy={isSyncing || isIndexing}
            aria-keyshortcuts={
              command === undefined ? undefined : getHotkeyAriaLabel(command)
            }
            aria-label={`${account.email}${hasUnreadMail ? ", unread email" : ""}`}
            className="h-7 min-w-7 justify-start gap-0 overflow-visible rounded-md p-0"
            onClick={() => {
              openAccount(account.email);
            }}
            ref={ref}
            type="button"
            variant="secondary"
          >
            <span className="relative size-7 shrink-0" ref={targetRef}>
              <span className="relative grid size-7 place-items-center overflow-hidden rounded-md">
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
                {/*
                  Indexing runs for minutes, so it gets a determinate ring
                  rather than a spinner. The mask cuts out the center so the
                  conic gradient follows the avatar's rounded rectangle.
                */}
                {isIndexing ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-md"
                    style={{
                      WebkitMask:
                        "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                      WebkitMaskComposite: "xor",
                      background:
                        indexedRatio === undefined
                          ? "conic-gradient(var(--color-primary) 90deg, transparent 90deg)"
                          : `conic-gradient(var(--color-primary) ${indexedRatio * 360}deg, transparent 0deg)`,
                      mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                      maskComposite: "exclude",
                      padding: "1px",
                    }}
                  />
                ) : null}
              </span>
              {hasUnreadMail ? (
                <span
                  aria-hidden="true"
                  className="bg-destructive ring-background pointer-events-none absolute top-0 right-0 size-2 rounded-full ring-2"
                />
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
      <TooltipContent className="flex items-start gap-2" side="bottom">
        {/*
          One column for everything that describes the account, so the indexing
          line stacks under the address instead of running alongside it. The
          shortcut stays outside the column, pinned to the right of the whole
          block.
        */}
        <span className="flex flex-col">
          {account.displayName === undefined ? null : (
            <span>{account.displayName}</span>
          )}
          <span
            className={account.displayName === undefined ? "" : "opacity-70"}
          >
            {account.email}
          </span>
          {isIndexing ? (
            <span className="opacity-70">
              {indexedRatio === undefined
                ? "Indexing mail"
                : `Indexing mail — ${Math.round(indexedRatio * 100)}%`}
            </span>
          ) : null}
        </span>
        {command === undefined ? null : <HotkeyHint command={command} />}
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarAccountButton;
