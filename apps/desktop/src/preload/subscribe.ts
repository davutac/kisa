import * as Schema from "effect/Schema";
import { ipcRenderer } from "electron";

export const subscribe = <A, I>(
  channel: string,
  schema: Schema.Codec<A, I, never, never>,
  listener: (payload: A) => void
): (() => void) => {
  const subscription = (
    _event: Electron.IpcRendererEvent,
    payload: unknown
  ): void => {
    listener(Schema.decodeUnknownSync(schema)(payload));
  };

  ipcRenderer.on(channel, subscription);

  return () => {
    ipcRenderer.removeListener(channel, subscription);
  };
};
