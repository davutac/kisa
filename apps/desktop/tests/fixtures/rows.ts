import { Schema } from "effect";

const StringList = Schema.fromJsonString(Schema.Array(Schema.String));

/**
 * A row a test's own SELECT must find. A missing row fails the test here,
 * naming what went wrong, instead of as a property read of `undefined`.
 */
export const found = <Row>(row: Row | undefined): Row => {
  if (row === undefined) {
    throw new Error("Expected the SELECT to find a row");
  }

  return row;
};

/**
 * A JSON text column that holds a list of strings, as flags and label ids
 * are stored. Anything else in the column fails the test.
 */
export const stringList = (json: string): readonly string[] =>
  Schema.decodeSync(StringList)(json);
