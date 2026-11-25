import type { RemoteDatabaseClient } from "@repo/database/remote-client";
import type { MailStoreError } from "@repo/mail/errors";
import { getColumns, sql } from "drizzle-orm";
import type { InferInsertModel, SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Effect } from "effect";
import { Context, Predicate } from "effect";

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
 * multi-row and lookups name many ids at once. The bundled SQLite binds up to
 * 32,766 parameters (`SQLITE_MAX_VARIABLE_NUMBER`); the margin covers the few
 * a statement binds besides its rows or ids.
 */
export const MAX_BOUND_PARAMETERS = 32_000;
export const ID_CHUNK_SIZE = 10_000;

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

// Large writes and id lists bind their values as one JSON parameter, read
// back in SQLite with `json_each`. Drizzle builds a statement value by value,
// which for a batch of mail cost main more than SQLite took to run it; one
// parameter keeps building cheap whatever the batch size, and keeps the
// statement's text the same, so the database process prepares it once.

/** A value as its column stores it. Bytes cannot travel in JSON. */
const toStoredValue = (
  column: SQLiteColumn,
  value: Parameters<SQLiteColumn["mapToDriverValue"]>[0]
) => {
  if (value === null || value === undefined) {
    return null;
  }

  const stored = column.mapToDriverValue(value);

  if (stored instanceof Uint8Array) {
    throw new TypeError(`${column.name} holds bytes, which JSON cannot carry`);
  }

  // A bound string's lone surrogates become U+FFFD; through JSON, SQLite
  // would store them as invalid UTF-8. Header text a sender wrote may hold one.
  return Predicate.isString(stored) ? stored.toWellFormed() : stored;
};

const toJsonRows = (
  columns: readonly SQLiteColumn[],
  rows: readonly (readonly unknown[])[]
): string =>
  JSON.stringify(
    rows.map((row) =>
      columns.map((column, index) => toStoredValue(column, row[index]))
    )
  );

/** The value at `index` of the current `json_each` row named `alias`. */
const jsonValue = (alias: string, index: number): SQL =>
  sql.raw(`${alias}.value ->> ${index}`);

const changedValue = (index: number): SQL => sql.raw(`changed.v${index}`);

/**
 * Gives each row its own values in one UPDATE. Each row lists the `match`
 * columns' values, naming its target, then the `set` columns' values; `same`
 * is set alike on every target, and `where` narrows the targets to an
 * account, say. The rows are materialized first: left as a `json_each` join,
 * SQLite scans the targets and reads every row's JSON once for each.
 */
export const updateEach = (
  table: SQLiteTable,
  rows: readonly (readonly unknown[])[],
  options: {
    readonly match: readonly SQLiteColumn[];
    readonly same?: readonly (readonly [SQLiteColumn, unknown])[];
    readonly set: readonly SQLiteColumn[];
    readonly where: SQL | undefined;
  }
): SQL => {
  const columns = [...options.match, ...options.set];

  const assignments = [
    ...options.set.map(
      (column, index) =>
        sql`${sql.identifier(column.name)} = ${changedValue(options.match.length + index)}`
    ),
    ...(options.same ?? []).map(
      ([column, value]) =>
        sql`${sql.identifier(column.name)} = ${sql.param(value, column)}`
    ),
  ];

  const matches = options.match.map(
    (column, index) => sql`${column} = ${changedValue(index)}`
  );

  return sql`WITH changed AS MATERIALIZED (SELECT ${sql.join(
    columns.map((_, index) => sql.raw(`value ->> ${index} AS v${index}`)),
    sql`, `
  )} FROM json_each(${toJsonRows(columns, rows)})) UPDATE ${table} SET ${sql.join(
    assignments,
    sql`, `
  )} FROM changed WHERE ${sql.join(
    options.where === undefined ? matches : [options.where, ...matches],
    sql` AND `
  )}`;
};

/** `column IN` the given values, bound as one parameter. */
export const inJson = (
  column: SQLiteColumn,
  values: readonly (number | string)[]
): SQL =>
  sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(values)}))`;

/**
 * Inserts `rows`, bound as one parameter. With `upsert`, a row that collides
 * on `target` instead takes the `set` columns from the new row. Every row
 * names the same columns; those it leaves out take their defaults.
 */
export const insertRows = <TTable extends SQLiteTable>(
  table: TTable,
  rows: readonly InferInsertModel<TTable>[],
  upsert?: {
    readonly set: readonly (keyof TTable["_"]["columns"] & string)[];
    readonly target: readonly SQLiteColumn[];
  }
): SQL => {
  const columns = getColumns(table);

  const named = Object.keys(rows[0] ?? {}).flatMap((key) => {
    const column = columns[key];

    return column === undefined ? [] : [[key, column] as const];
  });

  const targets = named.map(([, column]) => column);

  const values = rows.map((row) => {
    const cells = new Map<string, unknown>(Object.entries(row));

    return named.map(([key]) => cells.get(key));
  });

  const conflict =
    upsert === undefined
      ? sql``
      : sql` ON CONFLICT (${sql.join(
          upsert.target.map((column) => sql.identifier(column.name)),
          sql`, `
        )}) DO UPDATE SET ${sql.join(
          upsert.set.flatMap((key) => {
            const column = columns[key];

            return column === undefined
              ? []
              : [
                  sql`${sql.identifier(column.name)} = excluded.${sql.identifier(column.name)}`,
                ];
          }),
          sql`, `
        )}`;

  // `WHERE true` keeps SQLite from reading the upsert's ON as a join's.
  return sql`INSERT INTO ${table} (${sql.join(
    targets.map((column) => sql.identifier(column.name)),
    sql`, `
  )}) SELECT ${sql.join(
    targets.map((_, index) => jsonValue("inserted", index)),
    sql`, `
  )} FROM json_each(${toJsonRows(targets, values)}) AS inserted WHERE true${conflict}`;
};

/**
 * Rows as the body of a SQL `VALUES` list, for an `UPDATE … FROM` that gives
 * each row its own values in one statement, where `jsonTable` cannot: bytes
 * bind only as parameters. Each value is encoded as the column at its
 * position stores it. SQLite names the list's columns `column1`, `column2`
 * and so on.
 */
export const valuesList = (
  columns: readonly SQLiteColumn[],
  rows: readonly (readonly unknown[])[]
): SQL =>
  sql.join(
    rows.map(
      (row) =>
        sql`(${sql.join(
          columns.map((column, index) => sql.param(row[index], column)),
          sql`, `
        )})`
    ),
    sql`, `
  );

/** Rows of `width` values each, in chunks SQLite can bind at once. */
export const chunkValues = <A>(rows: readonly A[], width: number) =>
  chunk(rows, Math.max(1, Math.floor(MAX_BOUND_PARAMETERS / width)));

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
