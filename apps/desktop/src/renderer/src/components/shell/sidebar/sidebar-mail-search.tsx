import { useLocation, useNavigate } from "@tanstack/react-router";
import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { getMailSearchPlaceholder } from "@/components/mail/mail-search/mail-search-bar";
import MailSearchCommandBar from "@/components/mail/mail-search/mail-search-command-bar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  HotkeyHint,
  useAppCommand,
} from "@/hotkeys";
import { cn } from "@/lib/utils";
import { createMailSearchQuery, formatSearchQuery } from "@/mail/search-query";
import type { SearchQuery } from "@/mail/search-query";
import { useOpenThread } from "@/mail/use-open-thread";
import type { MailThreadSummary } from "@/shared/ipc/mail";
import { useMailSearchStore } from "@/state/mail-search";
import { useMailbox } from "@/state/mailbox";

/**
 * The sidebar's top row: the Search button, then the row's icon actions.
 * Search opens the command bar, and so does `Mod+K` from anywhere, even with
 * the sidebar hidden. While the mailbox list shows results, the button names
 * their query and reopens the bar to refine it, and × beside it clears them.
 * `onReveal` shows a hidden sidebar when results fill the list, so that query
 * and its × are on screen.
 */
const SidebarMailSearch = ({
  actions,
  onReveal,
}: {
  readonly actions: ReactNode;
  readonly onReveal: () => void;
}) => {
  const mailbox = useMailbox();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const openThread = useOpenThread();
  const isShowingResults = useMailSearchStore((state) => state.isActive);
  const query = useMailSearchStore((state) => state.query);
  const exit = useMailSearchStore((state) => state.exit);
  const showResults = useMailSearchStore((state) => state.showResults);
  const [isBarOpen, setIsBarOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const previousPathRef = useRef(pathname);
  const display = getHotkeyDisplay("app.searchMail");
  const queryText = formatSearchQuery(query);

  useAppCommand("app.searchMail", () => setIsBarOpen(true));

  // Results belong to the mailbox view; leaving it ends the search.
  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = pathname;

    if (isShowingResults && previousPath === "/" && pathname !== "/") {
      exit();
    }
  }, [exit, isShowingResults, pathname]);

  const showAll = async (nextQuery: SearchQuery): Promise<void> => {
    setIsBarOpen(false);
    onReveal();

    if (pathname !== "/") {
      await navigate({ to: "/" });
    }

    showResults(nextQuery);
  };
  const openFromBar = (thread: MailThreadSummary): void => {
    setIsBarOpen(false);

    if (openThread(thread) === "inline" && pathname !== "/") {
      void navigate({ to: "/" });
    }
  };
  const clear = (): void => {
    setIsBarOpen(false);
    exit();
    window.requestAnimationFrame(() => {
      buttonRef.current?.focus();
    });
  };

  return (
    <div className="flex h-8 w-full items-center gap-1">
      <div
        className={cn(
          "flex h-8 min-w-0 flex-1 items-center rounded-md",
          isShowingResults && "bg-sidebar-accent"
        )}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
                aria-label={
                  isShowingResults ? `Edit search ${queryText}` : undefined
                }
                className={cn(
                  "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground h-8 min-w-0 flex-1 justify-start gap-2.5 px-2 text-[13px] font-normal",
                  isShowingResults
                    ? "text-sidebar-accent-foreground"
                    : "text-muted-foreground"
                )}
                onClick={() => setIsBarOpen(true)}
                ref={buttonRef}
                type="button"
                variant="ghost"
              >
                <SearchIcon className="size-4 stroke-[1.8]" />
                <span className="min-w-0 flex-1 truncate text-left">
                  {isShowingResults
                    ? queryText
                    : getMailSearchPlaceholder(mailbox)}
                </span>
              </Button>
            }
          />
          <TooltipContent className="flex items-center gap-2" side="bottom">
            {display.label}
            <HotkeyHint command="app.searchMail" />
          </TooltipContent>
        </Tooltip>
        {isShowingResults ? (
          <Button
            aria-label="Clear search results"
            className="text-muted-foreground hover:text-foreground mr-0.5 shrink-0"
            onClick={clear}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <XIcon />
          </Button>
        ) : null}
      </div>
      {actions}
      <MailSearchCommandBar
        initialQuery={isShowingResults ? query : createMailSearchQuery()}
        onClear={isShowingResults ? clear : undefined}
        onOpenChange={setIsBarOpen}
        onOpenThread={openFromBar}
        onShowAll={(nextQuery) => {
          void showAll(nextQuery);
        }}
        open={isBarOpen}
      />
    </div>
  );
};

export default SidebarMailSearch;
