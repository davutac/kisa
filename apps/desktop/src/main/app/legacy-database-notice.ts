import { stat } from "node:fs/promises";

import { getLegacyDatabasePath } from "../database-path";

/**
 * Whether the sign-in screen should say that the database from before the
 * mail engine was not carried over: for as long as that file is on disk. Only
 * its existence is checked; it is never opened.
 */
export const hasLegacyDatabase = async (options: {
  readonly isDevelopment: boolean;
  readonly userDataPath: string;
}): Promise<boolean> => {
  try {
    await stat(getLegacyDatabasePath(options));
    return true;
  } catch {
    return false;
  }
};
