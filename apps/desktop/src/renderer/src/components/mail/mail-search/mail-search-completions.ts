import {
  getSearchFilterLabel,
  SEARCH_FILTER_FIELDS,
} from "@/mail/search-query";
import type {
  FilterDraft,
  SearchFilter,
  SearchFilterField,
} from "@/mail/search-query";
import type {
  GmailAddressRole,
  GmailSenderSuggestion,
} from "@/shared/ipc/mail";

export type MailSearchCompletionIcon = "address" | "attachment" | "operator";

export interface MailSearchCompletionItem {
  icon: MailSearchCompletionIcon;
  label: string;
  onSelect: () => void;
  shortcut?: string;
  sublabel?: string;
  value: string;
}

export interface MailSearchCompletions {
  empty?: string;
  heading: string;
  items: readonly MailSearchCompletionItem[];
}

interface CompletionInputs {
  draft?: FilterDraft;
  draftFilter?: SearchFilter;
  onSelectField: (field: SearchFilterField) => void;
  onSelectFilter: (filter: SearchFilter) => void;
  senders: readonly GmailSenderSuggestion[];
  typedWord: string;
}

const ATTACHMENT_FILTER_VALUES = ["attachment"] as const;

const FILTER_EXAMPLES = {
  from: "person@example.com",
  has: "attachment",
  subject: "invoice",
  to: "person@example.com",
} satisfies Record<(typeof SEARCH_FILTER_FIELDS)[number], string>;

const NUMBER_FORMAT = new Intl.NumberFormat();
const ADDRESS_HEADINGS = { from: "From user", to: "Sent to" } as const;
const ADDRESS_EMPTY = {
  from: "No indexed sender answers to that name.",
  to: "No sent-mail recipient answers to that name.",
} as const;

export const getMailSearchAddressRole = (
  field: SearchFilterField | undefined
): GmailAddressRole | undefined => {
  if (field === "from") {
    return "sender";
  }
  return field === "to" ? "recipient" : undefined;
};

const toAddressItems = (
  field: "from" | "to",
  senders: readonly GmailSenderSuggestion[],
  typedValue: string,
  onSelectFilter: (filter: SearchFilter) => void
): MailSearchCompletions => ({
  empty: ADDRESS_EMPTY[field],
  heading: ADDRESS_HEADINGS[field],
  items: [
    ...senders.map((sender) => ({
      icon: "address" as const,
      label: sender.name ?? sender.address,
      onSelect: () => onSelectFilter({ field, value: sender.address }),
      shortcut: NUMBER_FORMAT.format(sender.messageCount),
      sublabel:
        sender.name === undefined ||
        sender.name.toLowerCase() === sender.address.toLowerCase()
          ? undefined
          : sender.address,
      value: `address:${sender.address}`,
    })),
    ...(typedValue.length === 0
      ? []
      : [
          {
            icon: "operator" as const,
            label: `Use “${typedValue}” as typed`,
            onSelect: () => onSelectFilter({ field, value: typedValue }),
            value: "address:as-typed",
          },
        ]),
  ],
});

export const getMailSearchCompletions = ({
  draft,
  draftFilter,
  onSelectField,
  onSelectFilter,
  senders,
  typedWord,
}: CompletionInputs): MailSearchCompletions => {
  if (draft === undefined) {
    const matchingFields =
      typedWord.length === 0
        ? SEARCH_FILTER_FIELDS
        : SEARCH_FILTER_FIELDS.filter((field) => field.startsWith(typedWord));
    const fields =
      matchingFields.length === 0 ? SEARCH_FILTER_FIELDS : matchingFields;
    return {
      heading: "Filters",
      items: fields.map((field) => ({
        icon: "operator" as const,
        label: `${field}:`,
        onSelect: () => onSelectField(field),
        sublabel: FILTER_EXAMPLES[field],
        value: `field:${field}`,
      })),
    };
  }

  const typedValue = draft.value.trim();
  if (draft.field === "from" || draft.field === "to") {
    return toAddressItems(draft.field, senders, typedValue, onSelectFilter);
  }
  if (draft.field === "has") {
    const matches = ATTACHMENT_FILTER_VALUES.filter((value) =>
      value.startsWith(typedValue.toLowerCase())
    );
    return {
      empty: "No search options match that value.",
      heading: getSearchFilterLabel(draft.field),
      items: matches.map((value) => ({
        icon: "attachment" as const,
        label: `${draft.field}:${value}`,
        onSelect: () => onSelectFilter({ field: draft.field, value }),
        value: `value:${value}`,
      })),
    };
  }

  return draftFilter === undefined
    ? {
        empty: "Type a value for this filter.",
        heading: getSearchFilterLabel(draft.field),
        items: [],
      }
    : {
        heading: getSearchFilterLabel(draftFilter.field),
        items: [
          {
            icon: "operator",
            label: `${draftFilter.field}: ${draftFilter.value}`,
            onSelect: () => onSelectFilter(draftFilter),
            value: "draft:commit",
          },
        ],
      };
};
