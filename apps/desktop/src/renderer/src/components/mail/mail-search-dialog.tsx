import { useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Command as CommandPrimitive } from "cmdk";
import {
  AtSignIcon,
  LaptopIcon,
  PaperclipIcon,
  SearchIcon,
  TagIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import MailRelativeTime from "@/components/mail/relative-time";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { parseMailboxAddress } from "@/mail/address";
import { formatGmailLabel } from "@/mail/label";
import {
  addSearchFilter,
  addSearchFilters,
  createScopedSearchQuery,
  extractSearchFilters,
  getSearchAccountIds,
  getSearchFilterLabel,
  hasInboxSearchScope,
  isSearchQueryScopeOnly,
  parseFilterDraft,
  removeFilterDraft,
  removeSearchFilterAt,
  SEARCH_FILTER_FIELDS,
} from "@/mail/search-query";
import type {
  FilterDraft,
  SearchFilter,
  SearchFilterField,
  SearchLabelSuggestion,
  SearchQuery,
} from "@/mail/search-query";
import { getThreadSelectionKey } from "@/mail/thread-selection";
import {
  useAddressSuggestions,
  useLabelSuggestions,
  useMailSearch,
} from "@/mail/use-mail-search";
import type {
  GmailAddressRole,
  GmailSenderSuggestion,
  GmailThreadSummary,
} from "@/shared/ipc/mail";
import { useGoogleAccounts } from "@/state/google-accounts";
import { useMailboxStore, useSelectedAccountId } from "@/state/mailbox";

/**
 * An operator counts as a filter the moment it has a value, so
 * `subject:stunden` searches while it is being typed rather than waiting for
 * the space that turns it into a pill — an operator with nothing to complete
 * would otherwise leave the palette looking broken.
 */
const toDraftFilter = (
  draft: FilterDraft | undefined
): SearchFilter | undefined =>
  draft === undefined || draft.value.trim().length === 0
    ? undefined
    : { field: draft.field, value: draft.value.trim() };

const toLiveQuery = (
  query: SearchQuery,
  draft: FilterDraft | undefined,
  draftFilter: SearchFilter | undefined
): SearchQuery =>
  draft === undefined
    ? query
    : {
        filters:
          draftFilter === undefined
            ? query.filters
            : [...query.filters, draftFilter],
        text: removeFilterDraft(query.text),
      };

/** The item Enter commits: the first completion, else the first result. */
const toFirstItem = (
  completions: Completions | undefined,
  threads: readonly GmailThreadSummary[]
): string => {
  const completion = completions?.items[0]?.value;

  if (completion !== undefined) {
    return completion;
  }

  const [thread] = threads;

  return thread === undefined ? "" : `thread:${getThreadSelectionKey(thread)}`;
};

interface MailSearchDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

/** Values worth offering for the operators that only take a fixed few. */
const FIXED_FILTER_VALUES: Partial<
  Record<SearchFilterField, readonly string[]>
> = {
  has: ["attachment"],
  is: ["unread", "read"],
};

const FILTER_EXAMPLES: Record<SearchFilterField, string> = {
  account: "you@example.com",
  from: "person@example.com",
  has: "attachment",
  is: "unread",
  label: "inbox",
  subject: "invoice",
  to: "person@example.com",
};

const NUMBER_FORMAT = new Intl.NumberFormat();

const getSenderLabel = (thread: GmailThreadSummary): string => {
  const mailbox = parseMailboxAddress(thread.from);

  return mailbox.name ?? mailbox.email;
};

const getAddressRole = (
  field: SearchFilterField | undefined
): GmailAddressRole | undefined => {
  if (field === "from") {
    return "sender";
  }

  return field === "to" ? "recipient" : undefined;
};

interface FilterPillProps {
  filter: SearchFilter;
  onRemove: () => void;
}

const FilterPill = ({ filter, onRemove }: FilterPillProps) => (
  <Badge className="bg-muted h-5 gap-1 pr-1 pl-2" variant="secondary">
    <span className="opacity-60">{getSearchFilterLabel(filter.field)}</span>
    <span className="max-w-48 truncate">
      {filter.field === "label" ? formatGmailLabel(filter.value) : filter.value}
    </span>
    <button
      aria-label={`Remove ${filter.field} filter`}
      className="hover:text-foreground rounded-full opacity-60"
      onClick={onRemove}
      type="button"
    >
      <XIcon className="size-2.5" />
    </button>
  </Badge>
);

type CompletionIcon =
  | "account"
  | "address"
  | "attachment"
  | "label"
  | "operator"
  | "system-label";

interface CompletionItem {
  icon: CompletionIcon;
  label: string;
  /** The filter this item commits, or the operator it starts typing. */
  onSelect: () => void;
  shortcut?: string;
  sublabel?: string;
  trailing?: string;
  /** cmdk's identity for the item, and what the selection is tracked by. */
  value: string;
}

interface Completions {
  /** Shown when the group has nothing to offer, instead of nothing at all. */
  empty?: string;
  heading: string;
  items: readonly CompletionItem[];
}

interface CompletionInputs {
  accountIds: readonly string[];
  draft?: FilterDraft;
  draftFilter?: SearchFilter;
  /** Nothing has been asked yet, so the operators are worth listing. */
  isQueryEmpty: boolean;
  labels: readonly SearchLabelSuggestion[] | undefined;
  onSelectField: (field: SearchFilterField) => void;
  onSelectFilter: (filter: SearchFilter) => void;
  senders: readonly GmailSenderSuggestion[];
  showLabelAccounts: boolean;
  typedWord: string;
}

const ADDRESS_HEADINGS = { from: "From user", to: "Sent to" } as const;

const ADDRESS_EMPTY = {
  from: "No indexed sender matches.",
  to: "No recipient of your sent mail matches.",
} as const;

const toAddressItems = (
  field: "from" | "to",
  senders: readonly GmailSenderSuggestion[],
  typedValue: string,
  onSelectFilter: (filter: SearchFilter) => void
): Completions => ({
  empty: ADDRESS_EMPTY[field],
  heading: ADDRESS_HEADINGS[field],
  items: [
    ...senders.map((sender) => ({
      icon: "address" as const,
      label: sender.name ?? sender.address,
      onSelect: () => {
        onSelectFilter({ field, value: sender.address });
      },
      shortcut: NUMBER_FORMAT.format(sender.messageCount),
      // Plenty of senders put their own address in the display name; showing
      // it twice says nothing.
      ...(sender.name === undefined ||
      sender.name.toLowerCase() === sender.address.toLowerCase()
        ? {}
        : { sublabel: sender.address }),
      value: `address:${sender.address}`,
    })),
    ...(typedValue.length === 0
      ? []
      : [
          {
            icon: "operator" as const,
            label: `Use “${typedValue}” as typed`,
            onSelect: () => {
              onSelectFilter({ field, value: typedValue });
            },
            value: "address:as-typed",
          },
        ]),
  ],
});

/**
 * What the field offers next, as data rather than markup: the parent needs to
 * know which item is first so it can hand cmdk a selection that exists.
 *
 * One group at a time — the operators when nothing is being typed, the values
 * for the operator that is, and for the operators with nothing to complete, the
 * typed value itself so it can become a pill from the keyboard.
 */
const toCompletions = ({
  accountIds,
  draft,
  draftFilter,
  isQueryEmpty,
  labels,
  onSelectField,
  onSelectFilter,
  senders,
  showLabelAccounts,
  typedWord,
}: CompletionInputs): Completions | undefined => {
  if (draft === undefined) {
    // Once something has been asked, the answer leads: the operator list is an
    // invitation, and it has already been accepted.
    if (typedWord.length === 0 && !isQueryEmpty) {
      return undefined;
    }

    const fields =
      typedWord.length === 0
        ? SEARCH_FILTER_FIELDS
        : SEARCH_FILTER_FIELDS.filter((field) => field.startsWith(typedWord));

    return fields.length === 0
      ? undefined
      : {
          heading: "Filters",
          items: fields.map((field) => ({
            icon: "operator" as const,
            label: `${field}:`,
            onSelect: () => {
              onSelectField(field);
            },
            sublabel: FILTER_EXAMPLES[field],
            value: `field:${field}`,
          })),
        };
  }

  const typedValue = draft.value.trim();

  if (draft.field === "account") {
    const matches = accountIds.filter((accountId) =>
      accountId.toLowerCase().includes(typedValue.toLowerCase())
    );

    return {
      empty: "No connected account matches.",
      heading: "Account",
      items: matches.map((accountId) => ({
        icon: "account" as const,
        label: accountId,
        onSelect: () => {
          onSelectFilter({ field: "account", value: accountId });
        },
        value: `account:${accountId}`,
      })),
    };
  }

  if (draft.field === "from" || draft.field === "to") {
    return toAddressItems(draft.field, senders, typedValue, onSelectFilter);
  }

  if (draft.field === "label") {
    const normalizedValue = typedValue.toLowerCase();
    const matches = (labels ?? []).filter((label) => {
      const displayLabel = formatGmailLabel(label.name).toLowerCase();

      return (
        label.name.toLowerCase().includes(normalizedValue) ||
        displayLabel.includes(normalizedValue)
      );
    });
    const hasExactMatch = matches.some(
      (label) =>
        label.name.toLowerCase() === normalizedValue ||
        formatGmailLabel(label.name).toLowerCase() === normalizedValue
    );

    return {
      empty: labels === undefined ? "Loading labels…" : "No labels match.",
      heading: "Label",
      items: [
        ...matches.map((label) => ({
          icon: label.isSystem ? ("system-label" as const) : ("label" as const),
          label: formatGmailLabel(label.name),
          onSelect: () => {
            onSelectFilter({ field: "label", value: label.name });
          },
          ...(showLabelAccounts
            ? { trailing: label.accountIds.join(", ") }
            : {}),
          value: `label:${label.name}`,
        })),
        ...(typedValue.length === 0 || hasExactMatch
          ? []
          : [
              {
                icon: "label" as const,
                label: `Use “${typedValue}” as typed`,
                onSelect: () => {
                  onSelectFilter({ field: "label", value: typedValue });
                },
                value: "label:as-typed",
              },
            ]),
      ],
    };
  }

  const fixedValues = FIXED_FILTER_VALUES[draft.field];

  if (fixedValues !== undefined) {
    const matches = fixedValues.filter((value) =>
      value.startsWith(typedValue.toLowerCase())
    );

    return matches.length === 0
      ? undefined
      : {
          heading: getSearchFilterLabel(draft.field),
          items: matches.map((value) => ({
            icon:
              draft.field === "has"
                ? ("attachment" as const)
                : ("operator" as const),
            label: `${draft.field}:${value}`,
            onSelect: () => {
              onSelectFilter({ field: draft.field, value });
            },
            value: `value:${value}`,
          })),
        };
  }

  return draftFilter === undefined
    ? undefined
    : {
        heading: getSearchFilterLabel(draftFilter.field),
        items: [
          {
            icon: "operator" as const,
            label: `${draftFilter.field}: ${draftFilter.value}`,
            onSelect: () => {
              onSelectFilter(draftFilter);
            },
            value: "draft:commit",
          },
        ],
      };
};

const COMPLETION_ICONS = {
  account: AtSignIcon,
  address: UserIcon,
  attachment: PaperclipIcon,
  label: TagIcon,
  operator: SearchIcon,
  "system-label": LaptopIcon,
} as const;

const CompletionGroup = ({ empty, heading, items }: Completions) => (
  <CommandGroup heading={heading}>
    {items.map((item) => {
      const Icon = COMPLETION_ICONS[item.icon];
      const handleSelect = (): void => {
        item.onSelect();
      };

      return (
        <CommandItem
          key={item.value}
          onSelect={handleSelect}
          value={item.value}
        >
          <Icon className="opacity-60" />
          <span className="truncate font-medium">{item.label}</span>
          {item.sublabel === undefined ? null : (
            <span className="text-muted-foreground truncate">
              {item.sublabel}
            </span>
          )}
          {item.trailing === undefined ? null : (
            <CommandShortcut className="max-w-[60%] truncate text-right text-xs tracking-normal">
              {item.trailing}
            </CommandShortcut>
          )}
          {item.shortcut === undefined ? null : (
            <CommandShortcut>{item.shortcut}</CommandShortcut>
          )}
        </CommandItem>
      );
    })}
    {items.length === 0 && empty !== undefined ? (
      <p className="text-muted-foreground px-2.5 py-3">{empty}</p>
    ) : null}
  </CommandGroup>
);

interface ResultRowProps {
  onSelect: (thread: GmailThreadSummary) => void;
  showAccount: boolean;
  thread: GmailThreadSummary;
}

const ResultRow = ({ onSelect, showAccount, thread }: ResultRowProps) => (
  <CommandItem
    className="items-start gap-3 py-2"
    onSelect={() => {
      onSelect(thread);
    }}
    value={`thread:${getThreadSelectionKey(thread)}`}
  >
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium">{getSenderLabel(thread)}</span>
        {showAccount ? (
          <span className="text-muted-foreground truncate text-[0.625rem]">
            {thread.accountId}
          </span>
        ) : null}
        {thread.hasAttachments ? (
          <PaperclipIcon className="opacity-60" />
        ) : null}
      </span>
      <span className="truncate">{thread.subject}</span>
      <span className="text-muted-foreground truncate">{thread.snippet}</span>
    </span>
    <MailRelativeTime
      className="text-muted-foreground text-[0.625rem]"
      timestamp={thread.latestAt}
    />
  </CommandItem>
);

interface ResultGroupProps {
  hasMore: boolean;
  isLoading: boolean;
  onSelect: (thread: GmailThreadSummary) => void;
  selectionToCenter: string | null;
  showAccount: boolean;
  threads: readonly GmailThreadSummary[];
}

const RESULT_ROW_HEIGHT = 68;

/**
 * The result rows are virtualised over the palette's own scroll container, so
 * a wide query stays a cheap render however many rows come back.
 *
 * `overscan` is what keeps the keyboard working: cmdk can only move its
 * selection between mounted items, so rows have to exist a screenful ahead of
 * the one being scrolled into view.
 */
const ResultGroup = ({
  hasMore,
  isLoading,
  onSelect,
  selectionToCenter,
  showAccount,
  threads,
}: ResultGroupProps) => {
  // The scroller is found from the rendered rows rather than through a ref:
  // `CommandList` is a wrapper around cmdk's own list and does not pass one
  // through, so a ref handed to it stays null and the virtualiser renders
  // nothing into a correctly sized spacer. Reading it back off the DOM is a
  // fact, not a hope.
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: threads.length,
    estimateSize: () => RESULT_ROW_HEIGHT,
    getItemKey: (index) => {
      const thread = threads[index];

      return thread === undefined ? index : getThreadSelectionKey(thread);
    },
    getScrollElement: () => scrollElement,
    overscan: 12,
  });
  const selectedIndex = threads.findIndex(
    (thread) => `thread:${getThreadSelectionKey(thread)}` === selectionToCenter
  );

  useEffect(() => {
    if (selectedIndex === -1 || scrollElement === null) {
      return;
    }

    // Run after cmdk's nearest-edge scroll so centering is the final position.
    const animationFrame = window.requestAnimationFrame(() => {
      const selectedRow = scrollElement.querySelector<HTMLElement>(
        `[data-index="${selectedIndex}"]`
      );

      selectedRow?.scrollIntoView({ block: "center" });
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [scrollElement, selectedIndex, selectionToCenter]);

  return (
    <CommandGroup heading={hasMore ? "Results (top matches)" : "Results"}>
      {threads.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-6 text-center">
          {isLoading ? "Searching…" : "No indexed mail matches this search."}
        </p>
      ) : (
        <div
          className="relative w-full"
          ref={(node) => {
            setScrollElement(
              node?.closest<HTMLElement>('[data-slot="command-list"]') ?? null
            );
          }}
          style={{ height: rowVirtualizer.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((row) => {
            const thread = threads[row.index];

            return thread === undefined ? null : (
              <div
                className="absolute top-0 left-0 w-full"
                data-index={row.index}
                key={row.key}
                ref={rowVirtualizer.measureElement}
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <ResultRow
                  onSelect={onSelect}
                  showAccount={showAccount}
                  thread={thread}
                />
              </div>
            );
          })}
        </div>
      )}
    </CommandGroup>
  );
};

/**
 * Search over the local mail index: everything the backfill has walked, not
 * just the inbox, and without spending Gmail quota on a keystroke.
 *
 * Nothing is queried until something is typed — an open palette is not a
 * question, so it asks one instead of listing mail nobody asked for.
 */
const MailSearchDialog = ({ isOpen, onOpenChange }: MailSearchDialogProps) => {
  const navigate = useNavigate();
  const accounts = useGoogleAccounts();
  const selectedAccountId = useSelectedAccountId();
  const openThread = useMailboxStore((state) => state.openThread);
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

  // Opening is what carries the mailbox's scope into the palette: the account
  // in the titlebar arrives as a pill, so the narrowing is visible and can be
  // taken off to search everything.
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);

    if (isOpen) {
      setQuery(createScopedSearchQuery(knownAccountId));
    }
  }

  // The operator being typed is not free text: `from:jo` must offer senders
  // rather than search every message body for "jo".
  const filterDraft = parseFilterDraft(query.text);
  const draftFilter = toDraftFilter(filterDraft);
  const searchQuery = toLiveQuery(query, filterDraft, draftFilter);
  const accountIds = getSearchAccountIds(searchQuery, allAccountIds);
  const isInboxScoped = hasInboxSearchScope(searchQuery);
  const isEmpty = isSearchQueryScopeOnly(searchQuery);
  const { hasMore, isLoading, threads } = useMailSearch(
    accountIds,
    searchQuery,
    isOpen && !isEmpty
  );
  // `to:` completes from this account's sent mail, `from:` from everything it
  // has received — the two sides of the same index.
  const addressRole = getAddressRole(filterDraft?.field);
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

  const completions = toCompletions({
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
  // cmdk tracks the highlighted item itself, and with filtering off it never
  // re-picks one when the groups change underneath: the highlight ends up on an
  // item that no longer exists and Enter does nothing. Owning the value means
  // the first item on screen is always the one Enter commits.
  const firstItem = toFirstItem(completions, isEmpty ? [] : threads);
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

  const close = (): void => {
    onOpenChange(false);
  };

  const openResult = (thread: GmailThreadSummary): void => {
    openThread(getThreadSelectionKey(thread));
    void navigate({ to: "/" });
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
        {/*
          `CommandInput` owns its `InputGroup` and takes no children, so the
          field is composed here from the same primitives: pills belong inside
          it, reading as part of the query rather than as chrome around it.
        */}
        <div className="p-2 pb-0">
          <InputGroup className="bg-input/20 dark:bg-input/30 h-auto min-h-8 flex-wrap gap-1 border-0 py-1 pr-2">
            <InputGroupAddon className="py-0">
              <SearchIcon className="shrink-0 opacity-50" />
            </InputGroupAddon>
            {query.filters.map((filter, index) => (
              <FilterPill
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
                // Backspace on an empty draft peels off the pill behind it, the
                // way every other token field behaves.
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
            <CompletionGroup {...completions} />
          )}
          {isEmpty ? null : (
            <ResultGroup
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
