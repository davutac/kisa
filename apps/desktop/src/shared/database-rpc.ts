import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

// RPC declarations are nominal classes by design.
// oxlint-disable eslint/max-classes-per-file

const EncodedDatabaseBytes = Schema.TaggedStruct("Bytes", {
  value: Schema.Uint8Array,
});

const DatabaseBytes = EncodedDatabaseBytes.pipe(
  Schema.decodeTo(
    Schema.Uint8Array,
    SchemaTransformation.transform({
      decode: ({ value }) => value,
      encode: (value) => ({ _tag: "Bytes" as const, value }),
    })
  )
);

const EncodedDatabaseBigInt = Schema.TaggedStruct("BigInt", {
  value: Schema.BigInt,
});

const DatabaseBigInt = EncodedDatabaseBigInt.pipe(
  Schema.decodeTo(
    Schema.BigInt,
    SchemaTransformation.transform({
      decode: ({ value }) => value,
      encode: (value) => ({ _tag: "BigInt" as const, value }),
    })
  )
);

const DatabaseValue = Schema.Union([
  DatabaseBytes,
  DatabaseBigInt,
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
]);

export const DatabaseRow = Schema.Array(DatabaseValue);
export type DatabaseRow = typeof DatabaseRow.Type;

export const DatabaseExecuteResult = Schema.Union([
  Schema.Undefined,
  DatabaseRow,
  Schema.Array(DatabaseRow),
]);
export type DatabaseExecuteResult = typeof DatabaseExecuteResult.Type;

export const DatabaseExecutePayload = Schema.Struct({
  method: Schema.Literals(["all", "get", "run", "values"]),
  params: Schema.Array(DatabaseValue),
  sql: Schema.String,
});
export type DatabaseExecutePayload = typeof DatabaseExecutePayload.Type;

// oxlint-disable-next-line unicorn/throw-new-error
export class DatabaseQueryError extends Schema.TaggedError<DatabaseQueryError>()(
  "DatabaseQueryError",
  { message: Schema.String }
) {}

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
