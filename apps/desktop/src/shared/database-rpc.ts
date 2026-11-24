// oxlint-disable eslint/max-classes-per-file -- RPC declarations are nominal classes by design.
import * as Predicate from "effect/Predicate";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

/** What SQLite binds as a parameter and returns in a column. */
export type DatabaseValue =
  | bigint
  | boolean
  | number
  | string
  | Uint8Array
  | null;

// The guards are the database process boundary's decoder: what crosses it is
// checked here, once, as it arrives.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decodes values arriving over the database RPC.
const isDatabaseValue = (value: unknown): value is DatabaseValue =>
  Predicate.isString(value) ||
  Predicate.isNull(value) ||
  (Predicate.isNumber(value) && Number.isFinite(value)) ||
  Predicate.isUint8Array(value) ||
  Predicate.isBigInt(value) ||
  Predicate.isBoolean(value);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decodes rows arriving over the database RPC.
const isDatabaseRow = (value: unknown): value is readonly DatabaseValue[] =>
  Array.isArray(value) && value.every(isDatabaseValue);

/**
 * Parameters and rows cross to and from the database process by structured
 * clone, which keeps bytes and big integers as they are, so they need no
 * encoding: each is checked in one pass and sent unchanged. A schema per
 * value cost several times the round trip itself on every statement.
 */
// oxlint-disable-next-line unicorn/no-useless-undefined -- Effect reads `undefined` as "already in encoded form".
const sentAsIs = { toCodecJson: () => undefined } as const;

export const DatabaseRow = Schema.declare(isDatabaseRow, sentAsIs);
export type DatabaseRow = typeof DatabaseRow.Type;

/** Database RPC reads always return row arrays; callers select at most one. */
export const DatabaseExecuteResult = Schema.declare(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Decodes results arriving over the database RPC.
  (value: unknown): value is readonly DatabaseRow[] =>
    Array.isArray(value) && value.every(isDatabaseRow),
  sentAsIs
);
export type DatabaseExecuteResult = typeof DatabaseExecuteResult.Type;

export const DatabaseExecutePayload = Schema.Struct({
  method: Schema.Literals(["all", "run", "values"]),
  params: DatabaseRow,
  sql: Schema.String,
});
export type DatabaseExecutePayload = typeof DatabaseExecutePayload.Type;

// oxlint-disable-next-line unicorn/throw-new-error
export class DatabaseQueryError extends Schema.TaggedError<
  DatabaseQueryError,
  { readonly brand: unique symbol }
>()("DatabaseQueryError", { message: Schema.String }) {}

export class ExecuteDatabase extends Rpc.make("ExecuteDatabase", {
  error: DatabaseQueryError,
  payload: DatabaseExecutePayload,
  success: DatabaseExecuteResult,
}) {}

export class DatabaseReady extends Rpc.make("DatabaseReady") {}

export class DatabaseRpcs extends RpcGroup.make(
  DatabaseReady,
  ExecuteDatabase
) {}
