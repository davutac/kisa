export type TemplateSelectionDirection = -1 | 1;

export const getNextTemplateSelectionIndex = (
  templateIds: readonly string[],
  selectedTemplateId: string | undefined,
  direction: TemplateSelectionDirection
): number | null => {
  if (templateIds.length === 0) {
    return null;
  }

  const selectedIndex =
    selectedTemplateId === undefined
      ? -1
      : templateIds.indexOf(selectedTemplateId);

  if (selectedIndex === -1) {
    return direction === 1 ? 0 : templateIds.length - 1;
  }

  return Math.max(
    0,
    Math.min(templateIds.length - 1, selectedIndex + direction)
  );
};
