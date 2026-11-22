import path from "node:path";

export const getDatabasePath = ({
  isDevelopment,
  userDataPath,
}: {
  isDevelopment: boolean;
  userDataPath: string;
}): string =>
  path.join(
    userDataPath,
    "database",
    isDevelopment ? "mail.dev.sqlite" : "mail.sqlite"
  );

export const getDatabaseKeyPath = (databasePath: string): string =>
  `${databasePath}.key`;
