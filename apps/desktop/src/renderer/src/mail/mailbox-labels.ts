import type { MailLabelColor, MailLabelSummary } from "@/shared/ipc/mail";

import { compareLabelDisplayNames } from "./label";

export interface MailboxLabelCatalog {
  readonly accountId: string;
  readonly labels: readonly MailLabelSummary[];
}

export interface MailboxLabelItem {
  readonly accountIds: readonly string[];
  readonly color?: MailLabelColor;
  readonly key: string;
  readonly name: string;
}

interface MutableMailboxLabelItem {
  readonly accountIds: string[];
  color?: MailLabelColor;
  hasConflictingColor: boolean;
  readonly key: string;
  readonly name: string;
}

export const normalizeMailboxLabelName = (name: string): string =>
  name.trim().toLowerCase();

const colorsMatch = (
  left: MailLabelColor | undefined,
  right: MailLabelColor | undefined
): boolean =>
  left?.background === right?.background && left?.text === right?.text;

/** User labels become one toggle per case-insensitive name across accounts. */
export const createMailboxLabelItems = (
  catalogs: readonly MailboxLabelCatalog[]
): readonly MailboxLabelItem[] => {
  const items = new Map<string, MutableMailboxLabelItem>();

  for (const catalog of catalogs) {
    for (const label of catalog.labels) {
      if (label.type !== "user") {
        continue;
      }

      const key = normalizeMailboxLabelName(label.name);
      if (key.length === 0) {
        continue;
      }

      const existing = items.get(key);
      if (existing === undefined) {
        items.set(key, {
          accountIds: [catalog.accountId],
          color: label.color,
          hasConflictingColor: false,
          key,
          name: label.name,
        });
        continue;
      }

      if (!existing.accountIds.includes(catalog.accountId)) {
        existing.accountIds.push(catalog.accountId);
      }
      if (!colorsMatch(existing.color, label.color)) {
        existing.hasConflictingColor = true;
      }
    }
  }

  return [...items.values()]
    .map(({ accountIds, color, hasConflictingColor, key, name }) => ({
      accountIds,
      color: hasConflictingColor ? undefined : color,
      key,
      name,
    }))
    .toSorted((left, right) => compareLabelDisplayNames(left.name, right.name));
};

export const normalizeMailboxLabelSelection = (
  names: readonly string[]
): readonly string[] =>
  [...new Set(names.map(normalizeMailboxLabelName).filter(Boolean))].toSorted();

export const retainAvailableMailboxLabels = (
  selectedNames: readonly string[],
  items: readonly MailboxLabelItem[]
): readonly string[] => {
  const available = new Set(items.map(({ key }) => key));
  return normalizeMailboxLabelSelection(selectedNames).filter((name) =>
    available.has(name)
  );
};

export const threadMatchesMailboxLabels = (
  threadLabels: readonly string[],
  selectedNames: readonly string[]
): boolean => {
  if (selectedNames.length === 0) {
    return true;
  }

  const labels = new Set(threadLabels.map(normalizeMailboxLabelName));
  return selectedNames.every((name) =>
    labels.has(normalizeMailboxLabelName(name))
  );
};
