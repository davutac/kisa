export type MessageSelectionDirection = -1 | 1;

export const getAdjacentMessageId = (
  messageIds: readonly string[],
  selectedMessageId: string,
  direction: MessageSelectionDirection
): string | null => {
  if (messageIds.length === 0) {
    return null;
  }

  const selectedIndex = messageIds.indexOf(selectedMessageId);
  if (selectedIndex === -1) {
    return direction === 1
      ? (messageIds[0] ?? null)
      : (messageIds.at(-1) ?? null);
  }

  const nextIndex = Math.max(
    0,
    Math.min(messageIds.length - 1, selectedIndex + direction)
  );

  return messageIds[nextIndex] ?? null;
};
