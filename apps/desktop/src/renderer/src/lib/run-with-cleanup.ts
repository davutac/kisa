/**
 * Runs `task`, then `cleanup`, whether the task resolves or rejects.
 *
 * React Compiler cannot compile `try`/`finally`, so components and hooks hand
 * their cleanup to this module-level helper instead of writing the block inline.
 */
export const runWithCleanup = async <T>(
  task: () => Promise<T>,
  cleanup: () => void
): Promise<T> => {
  try {
    return await task();
  } finally {
    cleanup();
  }
};
