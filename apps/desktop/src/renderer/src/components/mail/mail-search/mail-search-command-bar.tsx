import { Command as CommandPrimitive } from "cmdk";
import { ListIcon, SearchIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { RefObject } from "react";

import MailDate from "@/components/mail/mail-date";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import {
  getHotkeyAriaLabel,
  getHotkeyDisplay,
  useHotkeyLayer,
} from "@/hotkeys";
import { cn } from "@/lib/utils";
import { parseMailboxAddress } from "@/mail/address";
import {
  addSearchFilter,
  addSearchFilters,
  applyExternalMailSearchScope,
  extractSearchFilters,
  formatSearchQuery,
  parseFilterDraft,
  removeFilterDraft,
  removeSearchFilterAt,
  toLiveMailSearchQuery,
  toMailSearchDraftFilter,
} from "@/mail/search-query";
import type { SearchFilter, SearchQuery } from "@/mail/search-query";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import { useAddressSuggestions, useMailSearch } from "@/mail/use-mail-search";
import { useMailboxAccountScope } from "@/mail/use-mailbox-account-scope";
import type { MailThreadSummary } from "@/shared/ipc/mail";
import { useMailbox, useShowUnread } from "@/state/mailbox";

import {
  canSearchFromBar,
  CLEAR_SEARCH_VALUE,
  describeMailSearchScope,
  getMailSearchBarSections,
  getMailSearchPlaceholder,
  resolveMailSearchBarSelection,
  SHOW_ALL_RESULTS_VALUE,
} from "./mail-search-bar";
import MailSearchCompletionGroup from "./mail-search-completion-group";
import {
  getMailSearchAddressRole,
  getMailSearchCompletions,
} from "./mail-search-completions";
import MailSearchFilterPill from "./mail-search-filter-pill";

/** Enough to recognise the match; the mailbox list holds the rest. */
const RESULT_LIMIT = 8;

const toConversationValue = (thread: MailThreadSummary): string =>
  `thread:${getThreadSelectionKey(thread)}`;

const focusOnNextFrame = (ref: RefObject<HTMLElement | null>): void => {
  window.requestAnimationFrame(() => {
    ref.current?.focus();
  });
};

interface MailSearchCommandBarActions {
  /** Present while the mailbox list shows results, which it clears. */
  readonly onClear?: () => void;
  readonly onOpenThread: (thread: MailThreadSummary) => void;
  readonly onShowAll: (query: SearchQuery) => void;
}

interface MailSearchCommandBarProps extends MailSearchCommandBarActions {
  /** The bar edits a copy, so the list only changes on Show all results. */
  readonly initialQuery: SearchQuery;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}

const ConversationItem = ({
  onSelect,
  showAccount,
  thread,
}: {
  readonly onSelect: () => void;
  readonly showAccount: boolean;
  readonly thread: MailThreadSummary;
}) => {
  const sender = parseMailboxAddress(thread.from);

  return (
    <CommandItem onSelect={onSelect} value={toConversationValue(thread)}>
      <span
        className={cn(
          "w-36 shrink-0 truncate",
          thread.isUnread
            ? "text-foreground font-semibold"
            : "text-foreground/80"
        )}
      >
        {sender.name ?? sender.email}
      </span>
      <span className="text-muted-foreground min-w-0 flex-1 truncate">
        {thread.subject}
      </span>
      {showAccount ? (
        <span className="text-muted-foreground max-w-32 shrink-0 truncate">
          {thread.accountId}
        </span>
      ) : null}
      <MailDate
        className="text-muted-foreground shrink-0"
        timestamp={thread.latestAt}
        tooltip={false}
      />
    </CommandItem>
  );
};

/** Mounted only while the bar is open, so each opening starts afresh. */
const MailSearchCommandBarBody = ({
  initialQuery,
  inputRef,
  onClear,
  onOpenThread,
  onShowAll,
}: MailSearchCommandBarActions & {
  readonly initialQuery: SearchQuery;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}) => {
  const { accountIds } = useMailboxAccountScope();
  const scope = {
    mailbox: useMailbox(),
    unreadOnly: useShowUnread(),
  };
  const [query, setQuery] = useState(initialQuery);
  const [selection, setSelection] = useState("");
  const filterDraft = parseFilterDraft(query.text);
  const addressRole = getMailSearchAddressRole(filterDraft?.field);
  const senders = useAddressSuggestions(
    accountIds,
    addressRole,
    addressRole === undefined ? undefined : (filterDraft?.value ?? "")
  );
  const commitFilter = (filter: SearchFilter): void => {
    setQuery(
      addSearchFilter({ ...query, text: removeFilterDraft(query.text) }, filter)
    );
  };
  const selectField = (field: SearchFilter["field"]): void => {
    setQuery({ ...query, text: `${removeFilterDraft(query.text)}${field}:` });
  };
  const completions = getMailSearchCompletions({
    draft: filterDraft,
    draftFilter: toMailSearchDraftFilter(filterDraft),
    onSelectField: selectField,
    onSelectFilter: commitFilter,
    senders,
    typedWord: query.text.trim().toLowerCase(),
  });
  const canSearch = canSearchFromBar(query);
  const liveQuery = toLiveMailSearchQuery(query);
  const results = useMailSearch(
    accountIds,
    applyExternalMailSearchScope(liveQuery, scope),
    canSearch,
    RESULT_LIMIT
  );
  const sections = getMailSearchBarSections({
    canSearch,
    isDraftingFilter: filterDraft !== undefined,
    isShowingResults: onClear !== undefined,
  });
  const selectableValues = sections.flatMap((section) => {
    if (section === "completions") {
      return completions.items.map((item) => item.value);
    }
    if (section === "conversations") {
      return [
        SHOW_ALL_RESULTS_VALUE,
        ...results.threads.map(toConversationValue),
      ];
    }
    return [CLEAR_SEARCH_VALUE];
  });
  const scopeDescription = describeMailSearchScope(scope);
  const showAll = (): void => onShowAll(query);

  const renderSection = (section: (typeof sections)[number]) => {
    if (section === "completions") {
      return <MailSearchCompletionGroup key={section} {...completions} />;
    }

    if (section === "clear") {
      return onClear === undefined ? null : (
        <CommandGroup heading="Results in the mailbox" key={section}>
          <CommandItem onSelect={onClear} value={CLEAR_SEARCH_VALUE}>
            <XIcon className="opacity-60" />
            Clear search results
          </CommandItem>
        </CommandGroup>
      );
    }

    return (
      <CommandGroup heading="Conversations" key={section}>
        <CommandItem onSelect={showAll} value={SHOW_ALL_RESULTS_VALUE}>
          <ListIcon className="opacity-60" />
          <span className="shrink-0">Show all results</span>
          <span className="text-muted-foreground min-w-0 truncate">
            {formatSearchQuery(liveQuery)}
          </span>
        </CommandItem>
        {results.threads.map((thread) => (
          <ConversationItem
            key={getThreadSelectionKey(thread)}
            onSelect={() => onOpenThread(thread)}
            showAccount={accountIds.length > 1}
            thread={thread}
          />
        ))}
        {results.threads.length === 0 ? (
          <p className="text-muted-foreground px-2.5 py-2">
            {results.isLoading
              ? "Searching…"
              : `Nothing matches in ${scopeDescription}.`}
          </p>
        ) : null}
      </CommandGroup>
    );
  };

  return (
    <Command
      className="rounded-none bg-transparent p-0"
      onValueChange={setSelection}
      shouldFilter={false}
      value={resolveMailSearchBarSelection(selectableValues, selection)}
    >
      <InputGroup className="h-12 rounded-none border-0 border-b bg-transparent px-1 has-[[data-slot=input-group-control]:focus-visible]:ring-0 dark:bg-transparent">
        <InputGroupAddon className="shrink-0 py-0">
          <SearchIcon className="size-4 opacity-60" />
        </InputGroupAddon>
        <div className="scroll-fade-x no-scrollbar flex max-w-[50%] min-w-0 shrink-0 items-center gap-1 overflow-x-auto">
          {query.filters.map((filter, index) => (
            <MailSearchFilterPill
              filter={filter}
              key={`${filter.field}:${filter.value}`}
              onRemove={() => {
                setQuery(removeSearchFilterAt(query, index));
                focusOnNextFrame(inputRef);
              }}
            />
          ))}
        </div>
        <CommandPrimitive.Input
          aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
          aria-label={getHotkeyDisplay("app.searchMail").label}
          className="h-12 min-w-24 flex-1 bg-transparent text-sm outline-hidden"
          data-slot="input-group-control"
          onKeyDown={(event) => {
            if (
              event.key === "Backspace" &&
              query.text.length === 0 &&
              query.filters.length > 0
            ) {
              event.preventDefault();
              setQuery(removeSearchFilterAt(query, query.filters.length - 1));
            }
          }}
          onValueChange={(value) => {
            const extraction = extractSearchFilters(value);
            setQuery(
              addSearchFilters(
                { ...query, text: extraction.draft },
                extraction.filters
              )
            );
          }}
          placeholder={getMailSearchPlaceholder(scope.mailbox)}
          ref={inputRef}
          value={query.text}
        />
      </InputGroup>
      {/* Choosing with the pointer keeps the caret in the field. */}
      <CommandList
        className="scroll-fade-y max-h-[min(24rem,50vh)] p-1 **:data-[slot=command-item]:text-[13px]"
        onPointerDown={(event) => {
          event.preventDefault();
        }}
      >
        {sections.map(renderSection)}
      </CommandList>
      <p className="text-muted-foreground truncate border-t px-3 py-2">
        Searching {scopeDescription}
      </p>
    </Command>
  );
};

/**
 * Mail search as a command bar over the window, like Gmail's search box:
 * Enter shows every result in the mailbox list, and the best matching
 * conversations listed below it open directly. While open, the search layer
 * silences the app's shortcuts.
 */
const MailSearchCommandBar = ({
  initialQuery,
  onOpenChange,
  open,
  ...actions
}: MailSearchCommandBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  useHotkeyLayer("search", open);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="top-[18vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        initialFocus={inputRef}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Search mail</DialogTitle>
          <DialogDescription>
            Find a conversation, or show every result in the mailbox.
          </DialogDescription>
        </DialogHeader>
        <MailSearchCommandBarBody
          initialQuery={initialQuery}
          inputRef={inputRef}
          {...actions}
        />
      </DialogContent>
    </Dialog>
  );
};

export default MailSearchCommandBar;
