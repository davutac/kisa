import {
  ArrowDownIcon,
  ArrowUpIcon,
  MailIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import type { RefObject } from "react";

import AccountChip from "@/components/accounts/account-chip";
import MailDate from "@/components/mail/mail-date";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
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
import { Kbd, KbdGroup } from "@/components/ui/kbd";
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
import MailSearchCompletionGroup, {
  MAIL_SEARCH_GROUP_CLASS_NAME,
  MAIL_SEARCH_GROUP_LABEL_CLASS_NAME,
  MAIL_SEARCH_ITEM_CLASS_NAME,
  MailSearchCompletionHint,
  MailSearchItemIcon,
} from "./mail-search-completion-group";
import {
  getMailSearchAddressRole,
  getMailSearchCompletions,
} from "./mail-search-completions";
import MailSearchFilterPill from "./mail-search-filter-pill";

/** Enough to recognise the match; the mailbox list holds the rest. */
const RESULT_LIMIT = 8;

const FOOTER_KBD_CLASS_NAME = "h-5 min-w-5 rounded-md px-1.5 text-[11px]";

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
    <CommandItem
      className={MAIL_SEARCH_ITEM_CLASS_NAME}
      onSelect={onSelect}
      value={toConversationValue(thread)}
    >
      <MailSearchItemIcon className="mt-0.5 self-start" icon={MailIcon} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-foreground truncate",
            thread.isUnread && "font-semibold"
          )}
        >
          {sender.name ?? sender.email}
        </span>{" "}
        <span className="text-muted-foreground truncate text-xs/5">
          {thread.subject}
        </span>
      </span>{" "}
      {showAccount ? (
        <>
          <AccountChip
            accountId={thread.accountId}
            className="text-muted-foreground max-w-32 shrink-0"
          />{" "}
        </>
      ) : null}
      {thread.isUnread ? (
        <span
          aria-hidden="true"
          className="bg-primary size-1.5 shrink-0 rounded-full"
        />
      ) : null}
      <MailDate
        className={cn(
          "shrink-0 text-xs tabular-nums",
          thread.isUnread ? "text-foreground" : "text-muted-foreground"
        )}
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
  onDismiss,
  onOpenThread,
  onShowAll,
}: MailSearchCommandBarActions & {
  readonly initialQuery: SearchQuery;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onDismiss: () => void;
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
        <CommandGroup className={MAIL_SEARCH_GROUP_CLASS_NAME} key={section}>
          <CommandGroupLabel className={MAIL_SEARCH_GROUP_LABEL_CLASS_NAME}>
            Results in the mailbox
          </CommandGroupLabel>
          <CommandItem
            className={MAIL_SEARCH_ITEM_CLASS_NAME}
            onSelect={onClear}
            value={CLEAR_SEARCH_VALUE}
          >
            <MailSearchItemIcon icon={XIcon} />
            Clear search results
          </CommandItem>
        </CommandGroup>
      );
    }

    return (
      <CommandGroup className={MAIL_SEARCH_GROUP_CLASS_NAME} key={section}>
        <CommandGroupLabel className={MAIL_SEARCH_GROUP_LABEL_CLASS_NAME}>
          Conversations
        </CommandGroupLabel>
        <CommandItem
          className={MAIL_SEARCH_ITEM_CLASS_NAME}
          onSelect={showAll}
          value={SHOW_ALL_RESULTS_VALUE}
        >
          <MailSearchItemIcon icon={SearchIcon} />
          <span className="text-foreground shrink-0">
            Show all results
          </span>{" "}
          <span className="text-muted-foreground ml-auto min-w-0 truncate">
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
          <p className="text-muted-foreground px-3 py-2.5">
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
      filter={false}
      onQueryChange={(text) => {
        const extraction = extractSearchFilters(text);
        setQuery(
          addSearchFilters(
            { ...query, text: extraction.draft },
            extraction.filters
          )
        );
      }}
      onValueChange={(value) => setSelection(value ?? "")}
      query={query.text}
      value={resolveMailSearchBarSelection(selectableValues, selection) || null}
    >
      <div className="flex h-14 w-full min-w-0 items-center gap-3 px-4">
        <SearchIcon
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <div className="scroll-fade-x no-scrollbar flex max-w-[50%] min-w-0 shrink-0 items-center gap-1 overflow-x-auto empty:hidden">
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
        <CommandInput
          aria-keyshortcuts={getHotkeyAriaLabel("app.searchMail")}
          aria-label={getHotkeyDisplay("app.searchMail").label}
          className="h-14 min-w-24 text-base"
          onEscape={onDismiss}
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
          placeholder={getMailSearchPlaceholder(scope.mailbox)}
          ref={inputRef}
        />
      </div>
      <MailSearchCompletionHint {...completions} />
      <CommandList className="scroll-fade-y max-h-[min(28rem,55vh)] px-1 pb-1.5 **:data-[slot=command-item]:text-sm">
        {sections.map(renderSection)}
      </CommandList>
      {/* Always shown: the placeholder goes once typing starts, and only this
          line says a search is limited to unread mail. */}
      <div className="text-muted-foreground flex min-w-0 items-center gap-4 border-t px-4 py-2.5 text-xs">
        {/* The list's own keys, which no hotkey command owns. */}
        <span aria-hidden="true" className="flex shrink-0 items-center gap-4">
          <span className="flex items-center gap-1.5">
            <KbdGroup>
              <Kbd className={FOOTER_KBD_CLASS_NAME}>
                <ArrowUpIcon />
              </Kbd>
              <Kbd className={FOOTER_KBD_CLASS_NAME}>
                <ArrowDownIcon />
              </Kbd>
            </KbdGroup>
            Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className={FOOTER_KBD_CLASS_NAME}>Enter</Kbd>
            Select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd className={FOOTER_KBD_CLASS_NAME}>Esc</Kbd>
            Close
          </span>
        </span>
        <p className="ml-auto min-w-0 truncate">
          Searching <span className="text-foreground">{scopeDescription}</span>
        </p>
      </div>
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
        className="top-[14vh] translate-y-0 gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl shadow-black/40 sm:max-w-[40rem]"
        initialFocus={() => inputRef.current}
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          {/* Not "Search mail", the field's name: an agent finds each by a
              word the other lacks. */}
          <DialogTitle>Find mail</DialogTitle>
          <DialogDescription>
            Find a conversation, or show every result in the mailbox.
          </DialogDescription>
        </DialogHeader>
        <MailSearchCommandBarBody
          initialQuery={initialQuery}
          inputRef={inputRef}
          onDismiss={() => onOpenChange(false)}
          {...actions}
        />
      </DialogContent>
    </Dialog>
  );
};

export default MailSearchCommandBar;
