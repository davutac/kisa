import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import type { MailStoreError } from "@repo/mail/errors";
import { getColumns, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Effect } from "effect";
import { Context } from "effect";

export type MailTransaction = Parameters<
  Parameters<RemoteDatabaseClient["transaction"]>[0]
>[0];

/**
 * The engine's access to SQLite. Main runs it through the database utility
 * process; tests provide an in-memory database instead.
 */
export class MailDatabase extends Context.Service<
  MailDatabase,
  {
    readonly use: <A>(
      message: string,
      run: (database: RemoteDatabaseClient) => Promise<A>
    ) => Effect.Effect<A, MailStoreError>;
  }
>()("kisa/main/mail/engine/MailDatabase") {}

/**
 * Every statement is a round trip to the database process, so writes are
 * multi-row. Chunks stay under SQLite's historical 999 bound-parameter limit.
 */
const MAX_BOUND_PARAMETERS = 999;
export const ID_CHUNK_SIZE = 400;

export const chunk = <A>(items: readonly A[], size: number): readonly A[][] => {
  const chunks: A[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

export const chunkRows = <A>(
  rows: readonly A[],
  table: SQLiteTable
): readonly A[][] =>
  chunk(
    rows,
    Math.max(
      1,
      Math.floor(MAX_BOUND_PARAMETERS / Object.keys(getColumns(table)).length)
    )
  );

/** `excluded.<column>` for each named column, for multi-row upserts. */
export const excludedColumns = <TTable extends SQLiteTable>(
  table: TTable,
  keys: readonly (keyof TTable["_"]["columns"] & string)[]
): Record<string, SQL> => {
  const columns = getColumns(table);
  return Object.fromEntries(
    keys.flatMap((key) => {
      const column = columns[key];
      return column === undefined
        ? []
        : [[key, sql`excluded.${sql.identifier(column.name)}`] as const];
    })
  );
};

export const unique = <A>(items: Iterable<A>): readonly A[] => [
  ...new Set(items),
];

/** 64-bit server counters are stored as decimal text. */
export const toBigIntText = (value: bigint | undefined): string | undefined =>
  value === undefined ? undefined : value.toString();

export const fromBigIntText = (
  value: string | null | undefined
): bigint | undefined => {
  if (value === null || value === undefined || !/^\d+$/u.test(value)) {
    return undefined;
  }
  return BigInt(value);
};
