import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/** The part of Electron's `app` the demo profile needs. */
interface ProfilePaths {
  readonly getPath: (name: "userData") => string;
  readonly setPath: (name: "sessionData" | "userData", value: string) => void;
}

/** The directory this launch created, and the only one it may remove. */
let profilePath: string | undefined;

/**
 * Removes a directory this module made. Best effort: a file still held open
 * stays behind in the temporary directory, which the system clears.
 */
const removeDirectory = (directory: string): void => {
  try {
    rmSync(directory, { force: true, maxRetries: 2, recursive: true });
  } catch {
    // Left for the operating system.
  }
};

/**
 * Points Electron at a new, empty profile directory, so demo mode never
 * opens the user's database, settings or window state. It has to run before
 * the single-instance lock and before anything reads the user data path.
 *
 * Returns whether the app now runs in that profile. The caller must not
 * start when it does not: falling through would open the real profile with
 * the demo's mail servers in place of the user's.
 */
export const enterDemoProfile = (app: ProfilePaths): boolean => {
  let created: string | undefined;

  try {
    // Resolved, since the temporary directory is often reached through a
    // link and Electron may hand back the path either way.
    created = realpathSync(mkdtempSync(path.join(tmpdir(), "kisa-demo-")));

    app.setPath("userData", created);
    app.setPath("sessionData", created);

    if (realpathSync(app.getPath("userData")) === created) {
      profilePath = created;

      return true;
    }
  } catch {
    // Refused below, like a profile Electron did not take.
  }

  if (created !== undefined) {
    removeDirectory(created);
  }

  return false;
};

/** Removes the profile this launch created, and nothing else. */
export const removeDemoProfile = (): void => {
  const created = profilePath;
  profilePath = undefined;

  if (created === undefined) {
    return;
  }

  removeDirectory(created);
};
