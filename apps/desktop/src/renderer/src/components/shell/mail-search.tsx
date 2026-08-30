import { useLocation, useNavigate } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon, XIcon } from "lucide-react";
import { m, useReducedMotionConfig } from "motion/react";
import { useEffect, useRef, useState } from "react";

import MailSearchCompletionGroup from "@/components/mail/mail-search/mail-search-completion-group";
import {
  getMailSearchAddressRole,
  getMailSearchCompletions,
} from "@/components/mail/mail-search/mail-search-completions";
import MailSearchFilterPill from "@/components/mail/mail-search/mail-search-filter-pill";
import { Button } from "@/components/ui/button";
import { Command, CommandList } from "@/components/ui/command";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from "@/components/ui/input-group";
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
  useHotkeyLayer,
} from "@/hotkeys";
import { easeInOut, NO_MOTION } from "@/lib/motion";
import {
  addSearchFilter,
  addSearchFilters,
  extractSearchFilters,
  parseFilterDraft,
  removeFilterDraft,
  removeSearchFilterAt,
  toMailSearchDraftFilter,
} from "@/mail/search-query";
import type { SearchFilter } from "@/mail/search-query";
import { useAddressSuggestions } from "@/mail/use-mail-search";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import type { GmailMailbox } from "@/shared/ipc/mail";
import { useMailSearchStore } from "@/state/mail-search";
import { useMailbox } from "@/state/mailbox";

const SEARCH_WIDTH = "clamp(10rem, 32vw, 22rem)";

const getSearchPlaceholder = (mailbox: GmailMailbox): string => {
  if (mailbox === "spam") {
    return "Search Spam";
  }
  if (mailbox === "sent") {
    return "Search Sent";
  }
  return mailbox === "trash" ? "Search Trash" : "Search all mail";
};

const TitlebarMailSearch = () => {
  const { accountIds } = useMailboxAccountScope();
  const mailbox = useMailbox();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const display = getHotkeyDisplay("app.searchMail");
  const shouldReduceMotion = useReducedMotionConfig();
  const collapsedButtonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousPathRef = useRef(pathname);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [areCompletionsDismissed, setAreCompletionsDismissed] = useState(false);
  const [selection, setSelection] = useState("");
  const isActive = useMailSearchStore((state) => state.isActive);
  const query = useMailSearchStore((state) => state.query);
  const activate = useMailSearchStore((state) => state.activate);
  const exit = useMailSearchStore((state) => state.exit);
  const updateQuery = useMailSearchStore((state) => state.updateQuery);
  const filterDraft = parseFilterDraft(query.text);
  const draftFilter = toMailSearchDraftFilter(filterDraft);
  const addressRole = getMailSearchAddressRole(filterDraft?.field);
  const senders = useAddressSuggestions(
    accountIds,
    isActive ? addressRole : undefined,
    isActive && addressRole !== undefined
      ? (filterDraft?.value ?? "")
      : undefined
  );
  const focusInput = (): void => {
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };
  const closeSearch = (): void => {
    setIsInputFocused(false);
    exit();
    window.requestAnimationFrame(() => {
      collapsedButtonRef.current?.focus();
    });
  };
  const commitFilter = (filter: SearchFilter): void => {
    const nextQuery = addSearchFilter(
      { ...query, text: removeFilterDraft(query.text) },
      filter
    );
    updateQuery(nextQuery);
    setAreCompletionsDismissed(false);
  };
  const selectField = (field: SearchFilter["field"]): void => {
    updateQuery({
      ...query,
      text: `${removeFilterDraft(query.text)}${field}:`,
    });
    setAreCompletionsDismissed(false);
  };
  const completions = getMailSearchCompletions({
    draft: filterDraft,
    draftFilter,
    onSelectField: selectField,
    onSelectFilter: commitFilter,
    senders,
    typedWord: query.text.trim().toLowerCase(),
  });
  const firstCompletion = completions.items[0]?.value ?? "";
  const selectedCompletion = completions.items.some(
    (item) => item.value === selection
  )
    ? selection
    : firstCompletion;
  const isCompletionMenuOpen = isInputFocused && !areCompletionsDismissed;

  useHotkeyLayer("search", isActive && isInputFocused);

  const startSearch = (): void => {
    if (isActive) {
      setAreCompletionsDismissed(false);
      focusInput();
      return;
    }

    if (pathname === "/") {
      activate();
      return;
    }

    const navigateAndBegin = async (): Promise<void> => {
      await navigate({ to: "/" });
      activate();
    };
    void navigateAndBegin();
  };

  useAppCommand("app.searchMail", startSearch);

  useEffect(() => {
    if (isActive) {
      focusInput();
    }
  }, [isActive]);

  useEffect(() => {
    const previousPath = previousPathRef.current;
    previousPathRef.current = pathname;

    if (isActive && previousPath === "/" && pathname !== "/") {
      setIsInputFocused(false);
      exit();
    }
  }, [exit, isActive, pathname]);

  return (
    <m.div
      animate={{ width: isActive ? SEARCH_WIDTH : 28 }}
      className="app-titlebar-interactive relative h-7 shrink-0"
      initial={false}
      transition={shouldReduceMotion ? NO_MOTION : easeInOut(0.24)}
    >
      {isActive ? (
        <Command
          className="relative size-full overflow-visible rounded-md bg-transparent p-0"
          onValueChange={setSelection}
          shouldFilter={false}
          value={selectedCompletion}
        >
          <InputGroup className="bg-input/30 dark:bg-input/40 h-7 overflow-hidden border-0">
            <InputGroupAddon className="shrink-0 py-0">
              <SearchIcon className="opacity-60" />
            </InputGroupAddon>
            <div className="scroll-fade-x no-scrollbar flex max-w-[calc(100%_-_9rem)] min-w-0 shrink-0 items-center gap-1 overflow-x-auto">
              {query.filters.map((filter, index) => (
                <MailSearchFilterPill
                  filter={filter}
                  key={`${filter.field}:${filter.value}`}
                  onRemove={() => {
                    updateQuery(removeSearchFilterAt(query, index));
                    focusInput();
                  }}
                />
              ))}
            </div>
            <CommandPrimitive.Input
              aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
              aria-label={display.label}
              className="h-7 min-w-24 flex-1 bg-transparent text-xs/relaxed outline-hidden"
              data-slot="input-group-control"
              onBlur={() => {
                setIsInputFocused(false);
              }}
              onFocus={() => {
                setIsInputFocused(true);
                setAreCompletionsDismissed(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isCompletionMenuOpen) {
                    setAreCompletionsDismissed(true);
                  } else {
                    closeSearch();
                  }
                  return;
                }
                if (
                  event.key === "Backspace" &&
                  query.text.length === 0 &&
                  query.filters.length > 0
                ) {
                  event.preventDefault();
                  updateQuery(
                    removeSearchFilterAt(query, query.filters.length - 1)
                  );
                }
              }}
              onValueChange={(value) => {
                const extraction = extractSearchFilters(value);
                const nextQuery = addSearchFilters(
                  { ...query, text: extraction.draft },
                  extraction.filters
                );
                updateQuery(nextQuery);
                setAreCompletionsDismissed(false);
              }}
              placeholder={getSearchPlaceholder(mailbox)}
              ref={inputRef}
              value={query.text}
            />
            <InputGroupAddon align="inline-end" className="shrink-0 py-0 pr-1">
              <InputGroupButton
                aria-label="Close mail search"
                onClick={closeSearch}
                size="icon-xs"
              >
                <XIcon />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          {isCompletionMenuOpen ? (
            <div
              className="bg-popover text-popover-foreground border-border/50 absolute top-[calc(100%+0.35rem)] right-0 z-50 w-full min-w-64 overflow-hidden rounded-xl border p-1 shadow-lg"
              onPointerDown={(event) => {
                event.preventDefault();
              }}
            >
              <CommandList className="scroll-fade-y max-h-72">
                <MailSearchCompletionGroup {...completions} />
              </CommandList>
            </div>
          ) : null}
        </Command>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
                aria-label={display.label}
                className="size-7"
                onClick={startSearch}
                ref={collapsedButtonRef}
                size="icon"
                type="button"
                variant="secondary"
              >
                <SearchIcon />
              </Button>
            }
          />
          <TooltipContent className="flex items-center gap-2" side="bottom">
            {display.label}
            <HotkeyHint command="app.searchMail" />
          </TooltipContent>
        </Tooltip>
      )}
    </m.div>
  );
};

export default TitlebarMailSearch;
