import { formatGmailLabel } from "@/mail/label";
import {
  getSearchFilterLabel,
  SEARCH_FILTER_FIELDS,
} from "@/mail/search-query";
import type {
  FilterDraft,
  SearchFilter,
  SearchFilterField,
  SearchLabelSuggestion,
} from "@/mail/search-query";
import type {
  GmailAddressRole,
  GmailSenderSuggestion,
} from "@/shared/ipc/mail";

export type MailSearchCompletionIcon =
  | "account"
  | "address"
  | "attachment"
  | "label"
  | "operator"
  | "system-label";

export interface MailSearchCompletionItem {
  icon: MailSearchCompletionIcon;
  label: string;
  onSelect: () => void;
  shortcut?: string;
  sublabel?: string;
  trailing?: string;
  value: string;
}

export interface MailSearchCompletions {
  empty?: string;
  heading: string;
  items: readonly MailSearchCompletionItem[];
}

interface CompletionInputs {
  accountIds: readonly string[];
  draft?: FilterDraft;
  draftFilter?: SearchFilter;
  isQueryEmpty: boolean;
  labels: readonly SearchLabelSuggestion[] | undefined;
  onSelectField: (field: SearchFilterField) => void;
  onSelectFilter: (filter: SearchFilter) => void;
  senders: readonly GmailSenderSuggestion[];
  showLabelAccounts: boolean;
  typedWord: string;
}

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
            onSelect: () => onSelectFilter({ field, value: typedValue }),
            value: "address:as-typed",
          },
        ]),
  ],
});

export const getMailSearchCompletions = ({
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
}: CompletionInputs): MailSearchCompletions | undefined => {
  if (draft === undefined) {
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
            onSelect: () => onSelectField(field),
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
        onSelect: () => onSelectFilter({ field: "account", value: accountId }),
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
      empty:
        labels === undefined
          ? "Consulting the label drawer…"
          : "No label answers to that name.",
      heading: "Label",
      items: [
        ...matches.map((label) => ({
          icon: label.isSystem ? ("system-label" as const) : ("label" as const),
          label: formatGmailLabel(label.name),
          onSelect: () => onSelectFilter({ field: "label", value: label.name }),
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
                onSelect: () =>
                  onSelectFilter({ field: "label", value: typedValue }),
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
            onSelect: () => onSelectFilter({ field: draft.field, value }),
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
            icon: "operator",
            label: `${draftFilter.field}: ${draftFilter.value}`,
            onSelect: () => onSelectFilter(draftFilter),
            value: "draft:commit",
          },
        ],
      };
};
