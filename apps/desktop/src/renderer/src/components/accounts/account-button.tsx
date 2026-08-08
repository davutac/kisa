import { useSortable } from "@dnd-kit/react/sortable";
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
import { useHasUnreadMail } from "@/mail/use-has-unread-mail";
import { useAccountIndexProgress } from "@/mail/use-mail-index-progress";
import { useIsAccountSyncing } from "@/mail/use-mail-sync-state";
import { useMailboxNavigation } from "@/mail/use-mailbox-navigation";
import type { GoogleAccount } from "@/shared/ipc/auth";
import { useSelectedAccountId } from "@/state/mailbox";

interface TitlebarAccountButtonProps {
  account: GoogleAccount;
  index: number;
  shortcut?: string;
}

const TitlebarAccountButton = ({
  account,
  index,
  shortcut,
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
            aria-keyshortcuts={shortcut}
            aria-label={`${account.email}${hasUnreadMail ? ", unread email" : ""}`}
            className="h-7 min-w-7 justify-start gap-0 overflow-visible rounded-full p-0"
            onClick={() => {
              openAccount(account.email);
            }}
            ref={ref}
            type="button"
            variant="secondary"
          >
            <span className="relative size-7 shrink-0" ref={targetRef}>
              <span className="relative grid size-7 place-items-center overflow-hidden rounded-full">
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
                  Indexing runs for minutes, so it gets a ring rather than the
                  sync spinner: a determinate arc reads as "still working, this
                  far along" instead of an animation that never seems to end. It
                  paints over the sync overlay rather than yielding to it, so the
                  indicator does not blink out every fifteen seconds.

                  `closest-side` is load-bearing. The default `farthest-corner`
                  puts the gradient's 100% at the box corner — 19.8px on a 28px
                  avatar — so a 72% stop lands at 14.3px, outside the 14px circle
                  the parent clips to, and the ring renders entirely invisible.
                */}
                {isIndexing ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      WebkitMask:
                        "radial-gradient(circle closest-side, transparent 74%, black 76%)",
                      background:
                        indexedRatio === undefined
                          ? "conic-gradient(var(--color-primary) 90deg, transparent 90deg)"
                          : `conic-gradient(var(--color-primary) ${indexedRatio * 360}deg, transparent 0deg)`,
                      mask: "radial-gradient(circle closest-side, transparent 74%, black 76%)",
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
        {shortcut === undefined ? null : <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  );
};

export default TitlebarAccountButton;
