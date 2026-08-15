import type { CSSProperties } from "react";

import type { GmailLabelColor, GmailLabelSummary } from "@/shared/ipc/mail";

const SYSTEM_LABEL_NAMES = {
  CATEGORY_FORUMS: "Forums",
  CATEGORY_PERSONAL: "Primary",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_UPDATES: "Updates",
  CHAT: "Chats",
  DRAFT: "Drafts",
  IMPORTANT: "Important",
  INBOX: "Inbox",
  SCHEDULED: "Scheduled",
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

export const formatGmailLabel = (label: string): string =>
  SYSTEM_LABEL_NAMES[label.toUpperCase()] ?? label;

export const gmailLabelColorStyle = (
  color?: GmailLabelColor
): CSSProperties | undefined =>
  color === undefined
    ? undefined
    : { backgroundColor: color.background, color: color.text };

const toLinearColorChannel = (value: number): number => {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
};

export const gmailLabelTextColor = (
  background: string
): "#000000" | "#ffffff" => {
  const red = Number.parseInt(background.slice(1, 3), 16);
  const green = Number.parseInt(background.slice(3, 5), 16);
  const blue = Number.parseInt(background.slice(5, 7), 16);
  const luminance =
    0.2126 * toLinearColorChannel(red) +
    0.7152 * toLinearColorChannel(green) +
    0.0722 * toLinearColorChannel(blue);

  return luminance > 0.179 ? "#000000" : "#ffffff";
};

// Gmail reports its own labels by id, and user labels by the name their owner
// typed, so an id that Gmail reserves is what marks a label as a system one.
export const isSystemGmailLabel = (label: string): boolean =>
  Object.hasOwn(SYSTEM_LABEL_NAMES, label) || label.startsWith("CATEGORY_");

export const compareGmailLabelDisplayNames = (
  left: string,
  right: string
): number =>
  LABEL_NAME_COLLATOR.compare(formatGmailLabel(left), formatGmailLabel(right));

export const sortGmailLabelNames = (
  labels: readonly string[]
): readonly string[] =>
  labels.toSorted((left, right) => {
    const systemOrder =
      Number(isSystemGmailLabel(right)) - Number(isSystemGmailLabel(left));

    return systemOrder || compareGmailLabelDisplayNames(left, right);
  });

export const sortGmailLabelCatalog = (
  catalog: readonly GmailLabelSummary[]
): readonly GmailLabelSummary[] =>
  catalog.toSorted((left, right) => {
    const leftIsSystem =
      left.type === "system" || isSystemGmailLabel(left.name);
    const rightIsSystem =
      right.type === "system" || isSystemGmailLabel(right.name);
    const systemOrder = Number(rightIsSystem) - Number(leftIsSystem);

    return systemOrder || compareGmailLabelDisplayNames(left.name, right.name);
  });

export const listUserGmailLabels = (
  catalog: readonly GmailLabelSummary[]
): readonly GmailLabelSummary[] =>
  catalog
    .filter((label) => label.type === "user")
    .toSorted((left, right) =>
      compareGmailLabelDisplayNames(left.name, right.name)
    );

export const withGmailLabelState = (
  labels: readonly string[],
  label: string,
  applied: boolean
): readonly string[] => {
  if (applied) {
    return labels.includes(label) ? labels : [...labels, label];
  }

  return labels.filter((candidate) => candidate !== label);
};

export const visibleGmailLabels = (
  labels: readonly string[],
  showSystemLabels: boolean
): readonly string[] =>
  showSystemLabels
    ? labels
    : labels.filter((label) => !isSystemGmailLabel(label));

export const hasInboxLabel = (labels: readonly string[]): boolean =>
  labels.includes("INBOX");

export const hasSpamLabel = (labels: readonly string[]): boolean =>
  labels.includes("SPAM");

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
