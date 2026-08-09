import { drizzle } from "drizzle-orm/sqlite-proxy";
import type {
  AsyncRemoteCallback,
  SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";

import { databaseRelations } from "./relations";

export type DatabaseRemoteCallback = AsyncRemoteCallback;
export type RemoteDatabaseClient = SqliteRemoteDatabase<
  typeof databaseRelations
>;

export const createRemoteDatabaseClient = (
  // Drizzle defines its proxy transport as a callback.
  // oxlint-disable-next-line promise/prefer-await-to-callbacks
  callback: DatabaseRemoteCallback
): RemoteDatabaseClient => drizzle(callback, { relations: databaseRelations });
