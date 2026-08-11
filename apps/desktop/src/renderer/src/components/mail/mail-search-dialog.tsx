import { useNavigate } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Command, CommandDialog, CommandList } from "@/components/ui/command";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import {
  addSearchFilter,
  addSearchFilters,
  createScopedSearchQuery,
  extractSearchFilters,
  getSearchAccountIds,
  hasInboxSearchScope,
  isSearchQueryScopeOnly,
  parseFilterDraft,
  removeFilterDraft,
  removeSearchFilterAt,
} from "@/mail/search-query";
import type { SearchFilter, SearchQuery } from "@/mail/search-query";
import {
  useAddressSuggestions,
  useLabelSuggestions,
  useMailSearch,
} from "@/mail/use-mail-search";
import { useOpenThread } from "@/mail/use-open-thread";
import type { GmailThreadSummary } from "@/shared/ipc/mail";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useSelectedAccountId } from "@/state/mailbox";

import MailSearchCompletionGroup from "./mail-search/mail-search-completion-group";
import {
  getMailSearchAddressRole,
  getMailSearchCompletions,
} from "./mail-search/mail-search-completions";
import MailSearchFilterPill from "./mail-search/mail-search-filter-pill";
import {
  getFirstMailSearchItem,
  toLiveMailSearchQuery,
  toMailSearchDraftFilter,
} from "./mail-search/mail-search-model";
import MailSearchResults from "./mail-search/mail-search-results";

interface MailSearchDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

const MailSearchDialog = ({ isOpen, onOpenChange }: MailSearchDialogProps) => {
  const navigate = useNavigate();
  const accounts = useGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const openThread = useOpenThread();
  const knownAccountId = accounts.some(
    ({ email }) => email === selectedAccountId
  )
    ? selectedAccountId
    : null;
  const [query, setQuery] = useState<SearchQuery>(() =>
    createScopedSearchQuery(knownAccountId)
  );
  const [wasOpen, setWasOpen] = useState(isOpen);
  const allAccountIds = useMemo(
    () => accounts.map(({ email }) => email),
    [accounts]
  );

  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setQuery(createScopedSearchQuery(knownAccountId));
    }
  }

  const filterDraft = parseFilterDraft(query.text);
  const draftFilter = toMailSearchDraftFilter(filterDraft);
  const searchQuery = toLiveMailSearchQuery(query, filterDraft, draftFilter);
  const accountIds = getSearchAccountIds(searchQuery, allAccountIds);
  const isInboxScoped = hasInboxSearchScope(searchQuery);
  const isEmpty = isSearchQueryScopeOnly(searchQuery);
  const { hasMore, isLoading, threads } = useMailSearch(
    accountIds,
    searchQuery,
    isOpen && !isEmpty
  );
  const addressRole = getMailSearchAddressRole(filterDraft?.field);
  const senders = useAddressSuggestions(
    accountIds,
    addressRole,
    addressRole === undefined ? undefined : (filterDraft?.value ?? "")
  );
  const labels = useLabelSuggestions(
    accountIds,
    filterDraft?.field === "label"
  );

  const commitFilter = (filter: SearchFilter): void => {
    setQuery((current) =>
      addSearchFilter(
        { ...current, text: removeFilterDraft(current.text) },
        filter
      )
    );
  };
  const completions = getMailSearchCompletions({
    accountIds: allAccountIds,
    draft: filterDraft,
    draftFilter,
    isQueryEmpty: isEmpty,
    labels,
    onSelectField: (field) => {
      setQuery((current) => ({
        ...current,
        text: `${removeFilterDraft(current.text)}${field}:`,
      }));
    },
    onSelectFilter: commitFilter,
    senders,
    showLabelAccounts: accountIds.length > 1,
    typedWord: query.text.trim().toLowerCase(),
  });
  const firstItem = getFirstMailSearchItem(completions, isEmpty ? [] : threads);
  const [selection, setSelection] = useState(firstItem);
  const [selectionToCenter, setSelectionToCenter] = useState<string | null>(
    firstItem
  );
  const [selectedFirstItem, setSelectedFirstItem] = useState(firstItem);
  const isKeyboardSelectionMoveRef = useRef(false);

  if (selectedFirstItem !== firstItem) {
    setSelectedFirstItem(firstItem);
    setSelection(firstItem);
    setSelectionToCenter(firstItem);
  }

  const close = (): void => onOpenChange(false);
  const openResult = (thread: GmailThreadSummary): void => {
    const location = openThread(thread);
    if (location === "inline") {
      void navigate({ to: "/" });
    }
    close();
  };

  return (
    <CommandDialog
      className="top-[calc(var(--app-titlebar-height)+1rem)] sm:max-w-2xl"
      description="Search every message the mail index has walked"
      onOpenChange={(open) => {
        if (open) {
          onOpenChange(true);
          return;
        }
        close();
      }}
      open={isOpen}
      title="Search mail"
    >
      <Command
        className="bg-background p-0"
        loop
        onKeyDown={() => {
          isKeyboardSelectionMoveRef.current = true;
        }}
        onKeyUp={() => {
          isKeyboardSelectionMoveRef.current = false;
        }}
        onValueChange={(value) => {
          setSelection(value);
          setSelectionToCenter(
            isKeyboardSelectionMoveRef.current ? value : null
          );
          isKeyboardSelectionMoveRef.current = false;
        }}
        shouldFilter={false}
        value={selection}
      >
        <div className="p-2 pb-0">
          <InputGroup className="bg-input/20 dark:bg-input/30 h-auto min-h-8 flex-wrap gap-1 border-0 py-1 pr-2">
            <InputGroupAddon className="py-0">
              <SearchIcon className="shrink-0 opacity-50" />
            </InputGroupAddon>
            {query.filters.map((filter, index) => (
              <MailSearchFilterPill
                filter={filter}
                key={`${filter.field}:${filter.value}`}
                onRemove={() => {
                  setQuery((current) => removeSearchFilterAt(current, index));
                }}
              />
            ))}
            <CommandPrimitive.Input
              autoFocus
              className="min-w-40 flex-1 bg-transparent text-xs/relaxed outline-hidden"
              data-slot="input-group-control"
              onKeyDown={(event) => {
                if (
                  event.key === "Backspace" &&
                  query.text.length === 0 &&
                  query.filters.length > 0
                ) {
                  event.preventDefault();
                  setQuery((current) =>
                    removeSearchFilterAt(current, current.filters.length - 1)
                  );
                }
              }}
              onValueChange={(value) => {
                const extraction = extractSearchFilters(value);
                setQuery((current) =>
                  addSearchFilters(
                    { ...current, text: extraction.draft },
                    extraction.filters
                  )
                );
              }}
              placeholder={
                isInboxScoped
                  ? "Search Inbox"
                  : "Search all mail — try from:someone@example.com"
              }
              value={query.text}
            />
          </InputGroup>
        </div>
        <CommandList className="max-h-96 px-1 py-2">
          {completions === undefined ? null : (
            <MailSearchCompletionGroup {...completions} />
          )}
          {isEmpty ? null : (
            <MailSearchResults
              hasMore={hasMore}
              isLoading={isLoading}
              onSelect={openResult}
              selectionToCenter={selectionToCenter}
              showAccount={accountIds.length > 1}
              threads={threads}
            />
          )}
        </CommandList>
        <div className="text-muted-foreground bg-card border-border/40 flex items-center gap-3 border-t px-4 py-2 text-[0.625rem]">
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd>esc</Kbd> close
          </span>
          <span className="ml-auto">
            {isInboxScoped
              ? "Searching Inbox."
              : "Searches every message indexed on this device."}
          </span>
        </div>
      </Command>
    </CommandDialog>
  );
};

export default MailSearchDialog;
