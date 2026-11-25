import type { MailLabelColor, MailLabelSummary } from "@/shared/ipc/mail";
import type { LabelCatalogLoadStatus } from "@/state/labels";

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

/** The labels a scope shows: each of its accounts' user labels, merged. */
export const getScopeLabelItems = (
  catalogs: ReadonlyMap<string, readonly MailLabelSummary[]>,
  accountIds: readonly string[]
): readonly MailboxLabelItem[] =>
  createMailboxLabelItems(
    accountIds.flatMap((accountId) => {
      const labels = catalogs.get(accountId);

      return labels === undefined ? [] : [{ accountId, labels }];
    })
  );

/** One sidebar label row, indented under the nearest label above it. */
export interface MailboxLabelRow {
  readonly depth: number;
  readonly item: MailboxLabelItem;
  /** The path below its parent row, or the full path at the top level. */
  readonly name: string;
}

const LABEL_PATH_SEPARATOR = "/";

/**
 * Nests labels by their `/`-separated paths, depth first. A label whose
 * parent path is not a label itself hangs from the nearest one that is and
 * keeps the rest of its path, so `Work/Clients` alone reads `Work/Clients`.
 */
export const toMailboxLabelRows = (
  items: readonly MailboxLabelItem[]
): readonly MailboxLabelRow[] => {
  const itemsByKey = new Map(items.map((item) => [item.key, item]));

  const childrenByParent = new Map<
    string | null,
    { readonly item: MailboxLabelItem; readonly name: string }[]
  >();

  for (const item of items) {
    const segments = item.name.split(LABEL_PATH_SEPARATOR);
    let parentKey: string | null = null;
    let nameStart = 0;

    for (let length = segments.length - 1; length > 0; length -= 1) {
      const candidate = normalizeMailboxLabelName(
        segments.slice(0, length).join(LABEL_PATH_SEPARATOR)
      );

      if (candidate !== item.key && itemsByKey.has(candidate)) {
        parentKey = candidate;
        nameStart = length;
        break;
      }
    }

    const siblings = childrenByParent.get(parentKey) ?? [];
    siblings.push({
      item,
      name: segments.slice(nameStart).join(LABEL_PATH_SEPARATOR),
    });
    childrenByParent.set(parentKey, siblings);
  }

  const rows: MailboxLabelRow[] = [];

  const visit = (parentKey: string | null, depth: number): void => {
    const children = (childrenByParent.get(parentKey) ?? []).toSorted(
      (left, right) => compareLabelDisplayNames(left.name, right.name)
    );

    for (const { item, name } of children) {
      rows.push({ depth, item, name });
      visit(item.key, depth + 1);
    }
  };

  visit(null, 0);

  return rows;
};

/**
 * A label place is gone only once every account in its scope has loaded a
 * catalog without the label. A catalog still loading, or one that failed to
 * load, keeps the place, so a slow or failed load never moves the reader.
 */
export const isMailboxLabelMissing = (
  label: string,
  accountIds: readonly string[],
  catalogs: ReadonlyMap<string, readonly MailLabelSummary[]>,
  statuses: ReadonlyMap<string, LabelCatalogLoadStatus>
): boolean => {
  const key = normalizeMailboxLabelName(label);

  return (
    accountIds.every((accountId) => statuses.get(accountId) === "ready") &&
    !accountIds.some((accountId) =>
      (catalogs.get(accountId) ?? []).some(
        (candidate) =>
          candidate.type === "user" &&
          normalizeMailboxLabelName(candidate.name) === key
      )
    )
  );
};
