import type { CSSProperties } from "react";

import type {
  MailLabelColor,
  MailLabelSummary,
  Mailbox,
} from "@/shared/ipc/mail";

const SYSTEM_LABEL_NAMES = {
  DRAFT: "Drafts",
  IMPORTANT: "Important",
  INBOX: "Inbox",
  SENT: "Sent",
  SPAM: "Spam",
  STARRED: "Starred",
  TRASH: "Trash",
  UNREAD: "Unread",
} satisfies Readonly<Record<string, string>>;

const LABEL_NAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const formatLabel = (label: string): string =>
  SYSTEM_LABEL_NAMES[label.toUpperCase()] ?? label;

export const labelColorStyle = (
  color?: MailLabelColor
): CSSProperties | undefined =>
  color === undefined
    ? undefined
    : { backgroundColor: color.background, color: color.text };

// System labels arrive by id, and user labels by the name their owner typed,
// so a reserved id is what marks a label as a system one.
export const isSystemLabel = (label: string): boolean =>
  Object.hasOwn(SYSTEM_LABEL_NAMES, label);

export const compareLabelDisplayNames = (left: string, right: string): number =>
  LABEL_NAME_COLLATOR.compare(formatLabel(left), formatLabel(right));

export const sortLabelNames = (labels: readonly string[]): readonly string[] =>
  labels.toSorted((left, right) => {
    const systemOrder =
      Number(isSystemLabel(right)) - Number(isSystemLabel(left));

    return systemOrder || compareLabelDisplayNames(left, right);
  });

export const sortLabelCatalog = (
  catalog: readonly MailLabelSummary[]
): readonly MailLabelSummary[] =>
  catalog.toSorted((left, right) => {
    const leftIsSystem = left.type === "system" || isSystemLabel(left.name);
    const rightIsSystem = right.type === "system" || isSystemLabel(right.name);
    const systemOrder = Number(rightIsSystem) - Number(leftIsSystem);

    return systemOrder || compareLabelDisplayNames(left.name, right.name);
  });

export const listUserLabels = (
  catalog: readonly MailLabelSummary[]
): readonly MailLabelSummary[] =>
  catalog
    .filter((label) => label.type === "user")
    .toSorted((left, right) => compareLabelDisplayNames(left.name, right.name));

export const withLabelState = (
  labels: readonly string[],
  label: string,
  applied: boolean
): readonly string[] => {
  if (applied) {
    return labels.includes(label) ? labels : [...labels, label];
  }

  return labels.filter((candidate) => candidate !== label);
};

export const filterVisibleLabels = (
  labels: readonly string[],
  showSystemLabels: boolean
): readonly string[] =>
  showSystemLabels ? labels : labels.filter((label) => !isSystemLabel(label));

/**
 * The system label every conversation in a mailbox carries. Rows listed in
 * that mailbox leave it out rather than repeat where the reader already is.
 */
export const getMailboxSystemLabel = (mailbox: Mailbox): string =>
  mailbox.toUpperCase();

export const hasInboxLabel = (labels: readonly string[]): boolean =>
  labels.includes("INBOX");

export const hasSentLabel = (labels: readonly string[]): boolean =>
  labels.includes("SENT");

export const hasSpamLabel = (labels: readonly string[]): boolean =>
  labels.includes("SPAM");

export const hasStarredLabel = (labels: readonly string[]): boolean =>
  labels.includes("STARRED");

export const hasTrashLabel = (labels: readonly string[]): boolean =>
  labels.includes("TRASH");

export const withReadStateLabel = (
  labels: readonly string[],
  isUnread: boolean
): readonly string[] => {
  if (!isUnread) {
    return labels.filter((label) => label !== "UNREAD");
  }

  return labels.includes("UNREAD") ? labels : [...labels, "UNREAD"];
};

export const withoutInboxLabel = (
  labels: readonly string[]
): readonly string[] => labels.filter((label) => label !== "INBOX");
