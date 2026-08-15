let quitInProgress = false;

/** Records that a real quit started so window close handlers stop hiding. */
export const beginQuit = (): void => {
  quitInProgress = true;
};

export const isQuitInProgress = (): boolean => quitInProgress;
