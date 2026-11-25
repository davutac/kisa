import { betterSQLite3Codecs } from "drizzle-orm/better-sqlite3/codecs";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import type {
  SqliteProxyExecutors,
  SqliteRemoteDatabase,
} from "drizzle-orm/sqlite-proxy";

import { databaseRelations } from "./relations";

type StatementParameters = Parameters<SqliteProxyExecutors["run"]>[1];

type RowMode = Parameters<SqliteProxyExecutors["all"]>[2];

/**
 * How one statement reaches the process that owns the SQLite connection.
 * `run` resolves to no rows. `all` resolves to every row as the array of its
 * column values, in select order.
 */
export type RemoteDatabaseExecute = (
  sql: string,
  params: StatementParameters,
  method: "all" | "run"
) => Promise<unknown[][]>;

export type RemoteDatabaseClient = SqliteRemoteDatabase<
  void,
  typeof databaseRelations
>;

/**
 * Rows cross the database boundary as arrays only, so the two things Drizzle
 * can ask for that an array of rows cannot answer are refused here, for every
 * transport: rows keyed by column name, which only raw `all(sql)` and
 * `get(sql)` request, and a single row. A query that needs at most one row
 * selects with `LIMIT 1` and takes the first.
 */
export const createRemoteDatabaseClient = (
  execute: RemoteDatabaseExecute
): RemoteDatabaseClient =>
  drizzle(
    {
      all: async (
        sql: string,
        params: StatementParameters,
        rowMode?: RowMode
      ) => {
        if (rowMode === "object") {
          throw new TypeError(
            "Remote database queries cannot return rows as objects"
          );
        }

        return await execute(sql, params, "all");
      },
      get: (): Promise<never> =>
        Promise.reject(
          new TypeError("Remote database get queries are unsupported")
        ),
      run: async (sql: string, params: StatementParameters) => {
        await execute(sql, params, "run");
      },
    },
    {
      // The proxy driver decodes nothing by itself, because it cannot know
      // what produced the rows. Kisa's rows are what better-sqlite3 returned
      // in the database process, sent unchanged, so they decode as that
      // driver's rows do. Without this a JSON column arrives as text and a
      // boolean as 0 or 1.
      codecs: betterSQLite3Codecs,
      relations: databaseRelations,
    }
  );
