import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { ipcMain } from "electron";

import * as DesktopIpc from "./desktop-ipc";
import { installDesktopIpcHandlers } from "./desktop-ipc-handlers";

const layer = Layer.effectDiscard(installDesktopIpcHandlers()).pipe(
  Layer.provide(DesktopIpc.layer(ipcMain))
);

const runtime = ManagedRuntime.make(layer);

export const startDesktopIpc = (): Promise<void> =>
  runtime.runPromise(Effect.void);

export const stopDesktopIpc = (): Promise<void> => runtime.dispose();
