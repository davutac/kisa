interface PermanentDeleteMailboxState {
  readonly isInSpam: boolean;
  readonly isInTrash: boolean;
}

export const canDeleteThreadForever = (
  state?: PermanentDeleteMailboxState
): boolean => state?.isInSpam === true || state?.isInTrash === true;
