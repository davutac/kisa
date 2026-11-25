import path from "node:path";

interface DatabasePathOptions {
  isDevelopment: boolean;
  userDataPath: string;
}

export const getDatabasePath = ({
  isDevelopment,
  userDataPath,
}: DatabasePathOptions): string =>
  path.join(
    userDataPath,
    "database",
    isDevelopment ? "mail.dev.sqlite" : "mail.sqlite"
  );

export const getDatabaseKeyPath = (databasePath: string): string =>
  `${databasePath}.key`;

/**
 * The database Kisa kept before the mail engine. It is never opened: only
 * whether it exists is checked, to tell the user what did not carry over.
 */
export const getLegacyDatabasePath = ({
  isDevelopment,
  userDataPath,
}: DatabasePathOptions): string =>
  path.join(
    userDataPath,
    "database",
    isDevelopment ? "app.dev.sqlite" : "app.sqlite"
  );
