import * as Schema from "effect/Schema";

export type IpcReply<T> =
  | { readonly data: T; readonly ok: true }
  | { readonly error: string; readonly ok: false };

export const IpcReply = <A, I, RD, RE>(
  data: Schema.Codec<A, I, RD, RE>
): Schema.Codec<
  IpcReply<A>,
  | { readonly data: I; readonly ok: true }
  | { readonly error: string; readonly ok: false },
  RD,
  RE
> =>
  Schema.Union([
    Schema.Struct({ data, ok: Schema.Literal(true) }),
    Schema.Struct({ error: Schema.String, ok: Schema.Literal(false) }),
  ]);
