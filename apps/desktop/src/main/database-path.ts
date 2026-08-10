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
    isDevelopment ? "app.dev.sqlite" : "app.sqlite"
  );

export const getDatabaseKeyPath = (databasePath: string): string =>
  `${databasePath}.key`;
