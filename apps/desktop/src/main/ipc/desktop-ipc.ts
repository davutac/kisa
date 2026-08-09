import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { IpcMainInvokeEvent } from "electron";

import { DesktopIpcRegistrationError } from "./desktop-ipc-registration-error";
import { DesktopIpcUnregistrationError } from "./desktop-ipc-unregistration-error";

export type DesktopIpcHandleListener = (
  event: IpcMainInvokeEvent,
  raw: unknown
) => unknown | Promise<unknown>;

export interface DesktopIpcMain {
  handle: (channel: string, listener: DesktopIpcHandleListener) => void;
  removeHandler: (channel: string) => void;
}

export interface DesktopIpcMethod<E, R> {
  readonly channel: string;
  readonly handler: (
    raw: unknown,
    event?: IpcMainInvokeEvent
  ) => Effect.Effect<unknown, E, R>;
}

export class DesktopIpc extends Context.Service<
  DesktopIpc,
  {
    readonly handle: <E, R>(
      method: DesktopIpcMethod<E, R>
    ) => Effect.Effect<void, DesktopIpcRegistrationError, R | Scope.Scope>;
  }
>()("kisa/main/ipc/DesktopIpc") {}

export const make = (ipcMain: DesktopIpcMain): DesktopIpc["Service"] =>
  DesktopIpc.of({
    handle: Effect.fn("desktop.ipc.register")(function* registerDesktopIpc<
      E,
      R,
    >({ channel, handler }: DesktopIpcMethod<E, R>) {
      const context = yield* Effect.context<R>();
      const runPromise = Effect.runPromiseWith(context);

      yield* Effect.acquireRelease(
        Effect.try({
          catch: (cause) => new DesktopIpcRegistrationError({ cause, channel }),
          try: () => {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, (event, raw) =>
              runPromise(
                handler(raw, event).pipe(
                  Effect.annotateLogs({ channel }),
                  Effect.withSpan("desktop.ipc.invoke", {
                    attributes: { channel },
                  })
                )
              )
            );
          },
        }),
        () =>
          Effect.try({
            catch: (cause) =>
              new DesktopIpcUnregistrationError({ cause, channel }),
            try: () => ipcMain.removeHandler(channel),
          }).pipe(Effect.orDie)
      );
    }),
  });

export const layer = (ipcMain: DesktopIpcMain) =>
  Layer.succeed(DesktopIpc, make(ipcMain));

export interface DesktopIpcMethodRegistration<
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
> {
  readonly channel: string;
  readonly handler: (
    input: Payload,
    event?: IpcMainInvokeEvent
  ) => Effect.Effect<Result, E, R>;
  readonly payload: Schema.Codec<
    Payload,
    EncodedPayload,
    PayloadDecodingServices,
    PayloadEncodingServices
  >;
  readonly result: Schema.Codec<
    Result,
    EncodedResult,
    ResultDecodingServices,
    ResultEncodingServices
  >;
}

export const makeIpcMethod = <
  Payload,
  EncodedPayload,
  Result,
  EncodedResult,
  E,
  R,
  PayloadDecodingServices = never,
  PayloadEncodingServices = never,
  ResultDecodingServices = never,
  ResultEncodingServices = never,
>(
  method: DesktopIpcMethodRegistration<
    Payload,
    EncodedPayload,
    Result,
    EncodedResult,
    E,
    R,
    PayloadDecodingServices,
    PayloadEncodingServices,
    ResultDecodingServices,
    ResultEncodingServices
  >
): DesktopIpcMethod<
  E | Schema.SchemaError,
  R | PayloadDecodingServices | ResultEncodingServices
> => {
  const decode = Schema.decodeUnknownEffect(method.payload);
  const encode = Schema.encodeUnknownEffect(method.result);

  return {
    channel: method.channel,
    handler: (raw, event) =>
      decode(raw).pipe(
        Effect.flatMap((input) => method.handler(input, event)),
        Effect.flatMap(encode),
        Effect.withSpan("desktop.ipc.method", {
          attributes: { channel: method.channel },
        })
      ),
  };
};
