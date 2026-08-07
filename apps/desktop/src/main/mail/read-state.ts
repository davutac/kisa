const GMAIL_UNREAD_LABEL_ID = "UNREAD";

export const hasUnreadLabel = (labelIds?: readonly string[]): boolean =>
  labelIds?.includes(GMAIL_UNREAD_LABEL_ID) === true;

export const removeUnreadLabel = (
  labelIds: readonly string[]
): readonly string[] =>
  labelIds.filter((labelId) => labelId !== GMAIL_UNREAD_LABEL_ID);

export const addUnreadLabel = (
  labelIds: readonly string[]
): readonly string[] =>
  hasUnreadLabel(labelIds) ? labelIds : [...labelIds, GMAIL_UNREAD_LABEL_ID];
