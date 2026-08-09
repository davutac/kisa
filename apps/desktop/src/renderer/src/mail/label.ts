const SYSTEM_LABEL_NAMES: Readonly<Record<string, string>> = {
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
};

export const formatGmailLabel = (label: string): string =>
  SYSTEM_LABEL_NAMES[label.toUpperCase()] ?? label;

// Gmail reports its own labels by id, and user labels by the name their owner
// typed, so an id that Gmail reserves is what marks a label as a system one.
export const isSystemGmailLabel = (label: string): boolean =>
  Object.hasOwn(SYSTEM_LABEL_NAMES, label) || label.startsWith("CATEGORY_");

export const visibleGmailLabels = (
  labels: readonly string[],
  showSystemLabels: boolean
): readonly string[] =>
  showSystemLabels
    ? labels
    : labels.filter((label) => !isSystemGmailLabel(label));

export const hasInboxLabel = (labels: readonly string[]): boolean =>
  labels.includes("INBOX");

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
