import { Schema } from "effect";

export const DatabaseUnlock = Schema.TaggedStruct("DatabaseUnlock", {
  key: Schema.Uint8Array,
});
